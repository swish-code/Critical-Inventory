import { createHash, randomBytes } from 'node:crypto'
import { config } from '../config.js'

/**
 * Server-side sessions in a cookie.
 *
 * Chosen over a JWT so a session can be revoked instantly. Only a SHA-256 of the
 * session id is held, so a dump of the store cannot be replayed as a login.
 *
 * The store is an in-memory Map: restarting the server signs everybody out.
 * `store` is the seam for a database later — anything with get/set/delete.
 */

export const COOKIE_NAME = 'ci_session'

const store = new Map()

const hash = (raw) => createHash('sha256').update(raw).digest('hex')
const ttlMs = () => config.session.ttlHours * 3600_000

/** Creates a session for an account and returns the raw id for the cookie. */
export function createSession(account) {
  const raw = randomBytes(32).toString('base64url')
  store.set(hash(raw), { account, expiresAt: Date.now() + ttlMs() })
  return raw
}

/** The account behind a session id, or null if it is unknown or expired. */
export function resolveSession(raw) {
  if (!raw) return null
  const key = hash(raw)
  const row = store.get(key)
  if (!row) return null
  if (row.expiresAt <= Date.now()) {
    store.delete(key)
    return null
  }
  return row.account
}

export function revokeSession(raw) {
  if (raw) store.delete(hash(raw))
}

/** Drops expired sessions so the Map cannot grow without bound. */
export function purgeExpiredSessions() {
  const now = Date.now()
  let n = 0
  for (const [k, v] of store) {
    if (v.expiresAt <= now) {
      store.delete(k)
      n++
    }
  }
  return n
}

setInterval(purgeExpiredSessions, 15 * 60_000).unref()

/**
 * Cookie flags. `Secure` is on unless COOKIE_INSECURE=1 for local http —
 * production must serve over HTTPS or the cookie will not be sent.
 */
const secureFlag = () => (config.session.cookieInsecure ? '' : ' Secure;')

export function sessionCookie(raw) {
  // Kept in step with the session's expiry, or the browser would keep sending a
  // cookie the server has already stopped honouring.
  const maxAge = Math.floor(ttlMs() / 1000)
  return `${COOKIE_NAME}=${raw}; Path=/; HttpOnly;${secureFlag()} SameSite=Lax; Max-Age=${maxAge}`
}

export function clearedCookie(name = COOKIE_NAME, path = '/') {
  return `${name}=; Path=${path}; HttpOnly;${secureFlag()} SameSite=Lax; Max-Age=0`
}

/** A short-lived cookie scoped to one path, e.g. the sign-in state. */
export function shortCookie(name, value, { path, maxAgeSeconds }) {
  return `${name}=${value}; Path=${path}; HttpOnly;${secureFlag()} SameSite=Lax; Max-Age=${maxAgeSeconds}`
}

/** Minimal cookie reader, so cookie-parser is not needed. */
export function readCookie(req, name) {
  const header = req.headers.cookie
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim())
  }
  return null
}
