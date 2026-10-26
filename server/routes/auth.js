import { Router } from 'express'
import { config } from '../config.js'
import { accountFor } from '../auth/accounts.js'
import { touchLogin } from '../auth/store.js'
import { recordLogin } from '../usage/track.js'
import {
  beginSignIn,
  completeSignIn,
  isConfigured,
  STATE_COOKIE,
  STATE_COOKIE_PATH,
  STATE_TTL_SECONDS,
} from '../auth/microsoft.js'
import { isLocked, verifyLocal } from '../auth/local.js'
import { requireAuth } from '../auth/middleware.js'
import {
  clearedCookie,
  createSession,
  readCookie,
  revokeSession,
  sessionCookie,
  shortCookie,
} from '../auth/sessions.js'

export const auth = Router()

/**
 * Everything the client needs to render the shell for this user. The pages and
 * locations are for the rail and the slicers only — the server enforces both
 * on every data request regardless.
 */
const sessionPayload = (user) => ({
  user: {
    email: user.email,
    name: user.name,
    role: user.role,
    isAdmin: user.isAdmin,
    pages: user.pages,
    locations: user.locations,
  },
})

auth.post('/logout', (req, res) => {
  revokeSession(req.sessionToken)
  res.setHeader('Set-Cookie', clearedCookie())
  res.json({ ok: true })
})

/** Who am I — used on boot to decide between the login page and the app. */
auth.get('/me', requireAuth, (req, res) => {
  res.json(sessionPayload(req.user))
})

/**
 * Which sign-in options the login page should offer, and who to ask for access
 * (the first administrator in ADMIN_EMAILS), for the "Request access" button.
 */
auth.get('/methods', (req, res) => {
  res.json({
    microsoft: isConfigured(),
    local: config.localLogin.enabled,
    contact: config.access.admins.find((e) => e !== config.localLogin.email) ?? config.access.admins[0] ?? null,
  })
})

/** Temporary email + password sign-in — see auth/local.js. */
auth.post('/local', (req, res) => {
  if (!config.localLogin.enabled) return res.status(404).json({ error: 'Not found' })
  if (isLocked(req.ip)) {
    return res.status(429).json({ error: 'Too many failed attempts. Try again in 15 minutes.' })
  }

  const account = verifyLocal(req.body ?? {}, req.ip)
  if (!account) return res.status(401).json({ error: 'Email or password is incorrect.' })

  revokeSession(req.sessionToken)
  const token = createSession(account)
  res.setHeader('Set-Cookie', sessionCookie(token))
  touchLogin(account.emails)
  recordLogin(account, token, req)
  console.log(`  [auth] signed in ${account.email} (local password)`)
  res.json(sessionPayload(account))
})

auth.get('/microsoft/start', (req, res) => {
  if (!isConfigured()) {
    return res.status(503).json({ error: 'Microsoft sign-in is not configured on this server.' })
  }
  const { url, state } = beginSignIn()
  res.setHeader(
    'Set-Cookie',
    shortCookie(STATE_COOKIE, state, { path: STATE_COOKIE_PATH, maxAgeSeconds: STATE_TTL_SECONDS })
  )
  res.redirect(url)
})

/**
 * Where Microsoft returns the browser.
 *
 * Every outcome ends in a redirect back to the app rather than a JSON body,
 * because a person is looking at this in a browser tab. Failures carry a short
 * reason in the query string so the login page can say what went wrong.
 */
auth.get('/microsoft/callback', async (req, res) => {
  const cookies = [clearedCookie(STATE_COOKIE, STATE_COOKIE_PATH)]
  const back = (params) => {
    res.setHeader('Set-Cookie', cookies)
    res.redirect(`${config.appOrigin}/?${new URLSearchParams(params)}`)
  }

  if (req.query.error) {
    return back({ signin: 'failed', reason: String(req.query.error_description || req.query.error).slice(0, 200) })
  }

  const code = String(req.query.code || '')
  const state = String(req.query.state || '')
  if (!code || !state) return back({ signin: 'failed', reason: 'Microsoft did not return a sign-in code.' })

  try {
    const identity = await completeSignIn({ code, state, browserState: readCookie(req, STATE_COOKIE) })
    const account = accountFor(identity)

    if (!account) {
      console.log(`  [auth] refused ${identity.email}: not on the allow-list`)
      return back({ signin: 'denied', email: identity.email })
    }

    // A fresh session id on every sign-in, and any previous one dropped.
    revokeSession(req.sessionToken)
    const token = createSession(account)
    cookies.push(sessionCookie(token))
    touchLogin(account.emails)
    recordLogin(account, token, req)
    console.log(`  [auth] signed in ${account.email}${account.isAdmin ? ' (admin)' : ''}`)
    return back({ signin: 'ok' })
  } catch (err) {
    return back({ signin: 'failed', reason: err.message.slice(0, 200) })
  }
})
