/**
 * Raised when the session has gone (expired, revoked, or taken off the
 * allow-list). The shell listens for this and returns to the login screen
 * instead of showing a generic error.
 */
export class UnauthorizedError extends Error {}

/*
 * Telling "the server broke" apart from "the server was not there".
 *
 * The API answers a fault with {"error": "..."}. Nothing answers at all when
 * the server is between restarts — the dev proxy replies 500 with a plain-text
 * body, and a dropped connection makes fetch reject outright. A response with
 * no error field is reported as what it is, and marked retryable.
 */
const UNREACHABLE = new Set([500, 502, 503, 504])
const UNREACHABLE_TEXT = 'The server is not responding — it may be restarting. Press Retry in a moment.'

function unreachable(message) {
  const err = new Error(message)
  err.retryable = true
  return err
}

/** What went wrong, in the console, in enough detail to act on. */
function logFailure({ method, path, status, error, body, ms }) {
  /* eslint-disable no-console */
  try {
    console.groupCollapsed(`[API] ${method} /api${path} ${status ?? 'network'} — ${error?.message ?? error}`)
    console.log('endpoint ', `${method} /api${path}`)
    console.log('status   ', status ?? '(no response — server unreachable)')
    console.log('took     ', `${ms} ms`)
    if (body && typeof body === 'object') console.log('body     ', body)
    console.log('next     ', 'Check the server console for the matching [api] line')
    console.groupEnd()
  } catch {
    /* a console that refuses must not break the request path */
  }
  /* eslint-enable no-console */
}

async function request(method, path, body, { signal } = {}) {
  const started = Date.now()
  let res
  try {
    res = await fetch(`/api${path}`, {
      method,
      signal,
      ...(method === 'GET'
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) }),
    })
  } catch (err) {
    // A caller that walked away is not a failure to report.
    if (err?.name === 'AbortError') throw err
    logFailure({ method, path, status: null, error: err, body, ms: Date.now() - started })
    throw unreachable(UNREACHABLE_TEXT)
  }

  const json = await res.json().catch(() => null)

  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent('ci:unauthorized'))
    throw new UnauthorizedError(json?.error || 'Session expired')
  }

  if (!res.ok) {
    const err = json?.error
      ? new Error(json.error)
      : UNREACHABLE.has(res.status)
        ? unreachable(`${UNREACHABLE_TEXT} (${res.status})`)
        : new Error(`Request failed (${res.status})`)
    err.status = res.status
    logFailure({ method, path, status: res.status, error: err, body, ms: Date.now() - started })
    throw err
  }
  return json ?? {}
}

/**
 * Reads survive a restart; writes do not get the chance.
 *
 * `node --watch` restarts the API on every server edit, so a read retries a
 * few times while the server comes back. Writes go through `send` and fail on
 * the spot, because repeating a write could apply it twice.
 */
const RETRY_DELAYS = [600, 1200, 2500, 4000]

async function read(method, path, body, options) {
  let lastError
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      return await request(method, path, body, options)
    } catch (err) {
      lastError = err
      if (!err.retryable) throw err
      if (options?.signal?.aborted) throw err
      if (attempt === RETRY_DELAYS.length) break
      await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]))
    }
  }
  throw lastError
}

const get = (path, options) => read('GET', path, undefined, options)
const send = (method, path, body) => request(method, path, body)

export const api = {
  /** Report queries: reads, whatever verb carries their filters. */
  query: (path, body, options) => read('POST', path, body, options),

  me: () => get('/auth/me'),
  methods: () => get('/auth/methods'),
  logout: () => send('POST', '/auth/logout'),
  localLogin: (email, password) => send('POST', '/auth/local', { email, password }),
  health: () => get('/health'),
  modelCheck: (_filters, options) => get('/model/check', options),
  clearCache: () => send('POST', '/cache/clear'),

  /** Slicer options for these filters, plus the model's date extent. */
  slicers: (filters, options) => read('POST', '/slicers', filters, options),
  dailyKpis: (filters, options) => read('POST', '/daily/kpis', filters, options),
  dailyTable: (filters, options) => read('POST', '/daily/table', filters, options),
  summaryMatrix: (filters, options) => read('POST', '/summary/matrix', filters, options),
  comparison: (filters, options) => read('POST', '/comparison', filters, options),

  /* Admin page */
  adminUsers: (_filters, options) => get('/admin/users', options),
  adminLocations: (_filters, options) => get('/admin/locations', options),
  adminUsage: ({ days }, options) => get(`/admin/usage?days=${days}`, options),
  createUser: (user) => send('POST', '/admin/users', user),
  updateUser: (email, patch) => send('PATCH', `/admin/users/${encodeURIComponent(email)}`, patch),
  deleteUser: (email) => send('DELETE', `/admin/users/${encodeURIComponent(email)}`),
}
