import { createHash } from 'node:crypto'
import { parseUserAgent } from './agent.js'
import { record } from './store.js'

/** The pages a browser may report. Anything else is ignored. */
export const TRACKED_PAGES = ['daily', 'summary', 'comparison', 'admin']

/** A session's id in the usage log: a short hash, never the cookie itself. */
export const sessionId = (rawToken) =>
  rawToken ? createHash('sha256').update(`usage:${rawToken}`).digest('hex').slice(0, 16) : null

/** One beat per session per this long, however often a browser sends them. */
const BEAT_MIN_GAP_MS = 50_000
const lastBeat = new Map()

function base(user, rawToken, req) {
  return {
    email: String(user.email ?? '').toLowerCase(),
    name: user.name || '',
    sid: sessionId(rawToken),
    ...parseUserAgent(req.headers['user-agent']),
  }
}

export function recordLogin(user, rawToken, req) {
  return record({ type: 'login', ...base(user, rawToken, req) })
}

/**
 * A page view or an active-minute beat from the browser. Returns false when
 * the event was ignored (unknown page or type, or a beat sent too soon).
 */
export function recordActivity(user, rawToken, req, { type, page }) {
  if (!TRACKED_PAGES.includes(page)) return false
  if (type !== 'view' && type !== 'beat') return false
  const sid = sessionId(rawToken)
  if (type === 'beat') {
    const now = Date.now()
    if (now - (lastBeat.get(sid) ?? 0) < BEAT_MIN_GAP_MS) return false
    lastBeat.set(sid, now)
  }
  record({ type, page: `/${page}`, ...base(user, rawToken, req) })
  return true
}
