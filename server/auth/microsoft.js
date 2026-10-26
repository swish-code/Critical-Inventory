import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { config, missingSignIn } from '../config.js'

/**
 * Interactive Microsoft sign-in (OpenID Connect authorization code + PKCE).
 *
 * The app registration that reads Power BI is reused, so the only extra setup
 * is registering the redirect URI on it (platform: Web). `openid`, `profile`
 * and `email` are the standard OIDC scopes and need no admin consent.
 *
 * Restricted to one tenant twice over: the authority is the tenant's own
 * endpoint rather than /common, and the returned token's tenant is checked.
 * Signing in proves *who someone is*; whether they get in is decided by
 * accounts.js.
 */

const AUTHORITY = () => `https://login.microsoftonline.com/${config.ms.tenantId}`
const SCOPES = 'openid profile email'
const STATE_TTL_MS = 10 * 60_000

/** Binds a sign-in to the browser that started it. */
export const STATE_COOKIE = 'ci_oidc'
export const STATE_COOKIE_PATH = '/api/auth/microsoft'
export const STATE_TTL_SECONDS = STATE_TTL_MS / 1000

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** Pending sign-ins, held in memory: they live for one redirect and no longer. */
const pending = new Map()

function sweep() {
  const now = Date.now()
  for (const [k, v] of pending) if (v.expires < now) pending.delete(k)
}

export function isConfigured() {
  return missingSignIn().length === 0
}

/**
 * Where to send the browser to sign in.
 *
 * PKCE is used even though this is a confidential client with a secret: it
 * costs nothing and stops an intercepted code being redeemed by somebody else.
 */
export function beginSignIn() {
  sweep()
  const state = b64url(randomBytes(24))
  const nonce = b64url(randomBytes(16))
  const verifier = b64url(randomBytes(32))
  const challenge = b64url(createHash('sha256').update(verifier).digest())

  pending.set(state, { nonce, verifier, expires: Date.now() + STATE_TTL_MS })

  const url = new URL(`${AUTHORITY()}/oauth2/v2.0/authorize`)
  url.searchParams.set('client_id', config.ms.clientId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', config.ms.redirectUri)
  url.searchParams.set('response_mode', 'query')
  url.searchParams.set('scope', SCOPES)
  url.searchParams.set('state', state)
  url.searchParams.set('nonce', nonce)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')

  return { url: url.toString(), state }
}

/** Reads a JWT's claims without verifying its signature — see the note below. */
function claims(jwt) {
  const part = jwt.split('.')[1]
  return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
}

export function sameString(a, b) {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && timingSafeEqual(x, y)
}

/**
 * Exchanges the code and returns the verified identity.
 *
 * The id_token's signature is not checked against the tenant's keys, and that
 * is a deliberate, bounded decision: the token was not accepted from the
 * browser. This server fetched it over TLS, directly from Microsoft's token
 * endpoint, authenticated with the client secret. What *is* checked are the
 * claims that bind it to this app, this tenant and this request — audience,
 * issuer, tenant, nonce and expiry.
 *
 * @param {{ code: string, state: string, browserState: string|null }} args
 *   `browserState` is the value of the state cookie the browser sent back.
 */
export async function completeSignIn({ code, state, browserState }) {
  sweep()
  if (!browserState || !sameString(browserState, state)) {
    throw new Error('This sign-in was started in a different browser. Start again.')
  }
  const held = pending.get(state)
  if (!held) throw new Error('This sign-in link has expired. Start again.')
  pending.delete(state)

  const body = new URLSearchParams({
    client_id: config.ms.clientId,
    client_secret: config.ms.clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.ms.redirectUri,
    code_verifier: held.verifier,
    scope: SCOPES,
  })

  const res = await fetch(`${AUTHORITY()}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15_000),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json.id_token) {
    throw new Error(json.error_description?.split('\n')[0] || `Microsoft rejected the sign-in (${res.status})`)
  }

  const c = claims(json.id_token)
  const tenant = String(config.ms.tenantId).toLowerCase()

  if (!sameString(c.aud ?? '', config.ms.clientId)) throw new Error('Sign-in token was issued for a different application.')
  if (!sameString(String(c.tid ?? '').toLowerCase(), tenant)) throw new Error('That account belongs to a different organisation.')
  if (!sameString(String(c.iss ?? '').toLowerCase(), `https://login.microsoftonline.com/${tenant}/v2.0`)) {
    throw new Error('Sign-in token came from a different issuer.')
  }
  if (!c.nonce || !sameString(c.nonce, held.nonce)) throw new Error('Sign-in could not be verified. Please try again.')
  if (Number(c.exp) * 1000 < Date.now()) throw new Error('Sign-in token had already expired.')

  // Every address this person could have been written down as: the user
  // principal name and the mailbox address are not always the same string.
  const candidates = [c.preferred_username, c.email, c.upn]
    .map((v) => String(v ?? '').trim())
    .filter((v) => v.includes('@'))

  const emails = [...new Set(candidates.map((v) => v.toLowerCase()))].map((lower) =>
    candidates.find((v) => v.toLowerCase() === lower)
  )

  if (!emails.length) throw new Error('Microsoft did not return an email address for this account.')

  return { email: emails[0], emails, name: String(c.name || '').trim() }
}
