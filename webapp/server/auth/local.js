import { createHash, timingSafeEqual } from 'node:crypto'
import { config } from '../config.js'
import { accountFor } from './accounts.js'

/**
 * Temporary email + password sign-in, for local testing only.
 *
 * One account, named in .env (LOCAL_LOGIN_EMAIL / LOCAL_LOGIN_PASSWORD), until
 * Microsoft sign-in is configured. It ends in the same session cookie as the
 * Microsoft flow, so every protected route behaves exactly as it will later.
 * Remove the two variables and this route answers 404.
 */

/** Equal-length digests, so the comparison takes the same time whatever was typed. */
const digest = (v) => createHash('sha256').update(String(v)).digest()
const same = (a, b) => timingSafeEqual(digest(a), digest(b))

/** Failed attempts per client, so the password cannot be guessed at speed. */
const MAX_FAILURES = 5
const WINDOW_MS = 15 * 60_000
const failures = new Map() // ip -> { count, until }

export function isLocked(ip) {
  const f = failures.get(ip)
  if (!f) return false
  if (f.until < Date.now()) {
    failures.delete(ip)
    return false
  }
  return f.count >= MAX_FAILURES
}

function noteFailure(ip) {
  const f = failures.get(ip)
  if (!f || f.until < Date.now()) failures.set(ip, { count: 1, until: Date.now() + WINDOW_MS })
  else f.count++
}

/**
 * The account for these credentials, or null.
 *
 * Both fields are always compared, so a wrong email and a wrong password take
 * the same time and say the same thing.
 */
export function verifyLocal({ email, password }, ip) {
  const { enabled, email: expected, password: secret } = config.localLogin
  if (!enabled) return null

  const emailOk = same(String(email ?? '').trim().toLowerCase(), expected)
  const passwordOk = same(password ?? '', secret)
  if (!emailOk || !passwordOk) {
    noteFailure(ip)
    return null
  }
  failures.delete(ip)
  return accountFor({ email: expected, name: '' })
}
