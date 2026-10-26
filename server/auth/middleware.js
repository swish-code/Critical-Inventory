import { canSeePage, currentAccount } from './accounts.js'
import { COOKIE_NAME, readCookie, resolveSession, revokeSession } from './sessions.js'

/**
 * Attaches req.user when a valid session cookie is present. Never rejects:
 * whatever needs a session says so itself, through requireAuth.
 *
 * The account is looked up again on every request, so a change made on the
 * Admin page — a page taken away, a location added, a user disabled — applies
 * on that person's very next request, not when their session happens to end.
 */
export function attachUser(req, res, next) {
  req.sessionToken = readCookie(req, COOKIE_NAME)
  const signedIn = resolveSession(req.sessionToken)
  const account = currentAccount(signedIn)
  if (signedIn && !account) revokeSession(req.sessionToken)
  req.user = account
  next()
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not signed in' })
  next()
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not signed in' })
  if (!req.user.isAdmin) return res.status(403).json({ error: 'Administrators only.' })
  next()
}

/** Refuses a page's data to someone who has not been given that page. */
export const requirePage = (page) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Not signed in' })
  if (!canSeePage(req.user, page)) return res.status(403).json({ error: 'You do not have access to this page.' })
  next()
}
