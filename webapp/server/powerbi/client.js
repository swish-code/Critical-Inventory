import { config } from '../config.js'
import { getAccessToken } from './auth.js'
import { HttpError } from './errors.js'

/**
 * Run DAX against the semantic model through the Power BI REST API
 * (executeQueries).
 *
 * The API accepts only one query per request, so callers that need several
 * should Promise.all them - each is independently cached in cache.js. Under that
 * concurrency Power BI intermittently answers 429 or 5xx, so transient failures
 * are retried within a time budget, and a gate bounds how many run at once.
 */

/** Power BI occasionally returns these under concurrent load; they retry cleanly. */
const TRANSIENT = new Set([429, 500, 502, 503, 504])
const RETRY_DELAYS = [600, 1800, 4500, 9000]

/** No response at all: DNS, TCP, TLS or a socket that died mid-flight. */
const NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
])

/**
 * Bounds on how long one query may take.
 *
 * Per-attempt timeouts alone multiply with retries, so the deadline caps the
 * *total* time a query may consume. A bulk extract legitimately takes longer,
 * so callers doing that pass `{ bulk: true }`.
 */
const REQUEST_TIMEOUT_MS = 8_000
const BULK_TIMEOUT_MS = 90_000
const REQUEST_DEADLINE_MS = 20_000

/**
 * Throttling gets its own, larger budget. A 429 is not a hang - it is the
 * service saying how long to wait, and waiting is the correct response.
 */
const THROTTLE_DEADLINE_MS = 75_000

/** `fetch` buries the real reason one or two levels down in `cause`. */
function causeChain(err) {
  const out = []
  let e = err
  for (let depth = 0; e && depth < 5; depth++) {
    if (e.code) out.push(e.code)
    e = e.cause
  }
  return out
}

/**
 * Power BI reports some transient conditions as 400 rather than 429 - "throttled
 * because the server is under memory pressure" arrives as a Bad Request.
 */
const TRANSIENT_TEXT = /throttled|memory pressure|try again later|temporarily unavailable|timeout/i

/** Whether another attempt is worth making, including bare network failures. */
function isRetryable(err) {
  if (TRANSIENT.has(err.status)) return true
  if (err.status === 400 && TRANSIENT_TEXT.test(err.message ?? '')) return true
  if (err.status) return false // a real HTTP answer we have already classified
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return true
  return causeChain(err).some((code) => NETWORK_CODES.has(code)) || err.name === 'TypeError'
}

/** Something a person can act on, instead of the bare "fetch failed". */
function describeNetworkError(err, attempts, timeoutMs = REQUEST_TIMEOUT_MS) {
  const codes = causeChain(err)
  const code = codes[codes.length - 1] ?? codes[0]
  const detail =
    err.name === 'TimeoutError'
      ? `it did not answer within ${Math.round(timeoutMs / 1000)}s`
      : code === 'ENOTFOUND' || code === 'EAI_AGAIN'
        ? 'the address could not be resolved — check DNS or the network connection'
        : code === 'ECONNRESET'
          ? 'the connection was reset mid-request'
          : code === 'UND_ERR_CONNECT_TIMEOUT'
            ? 'the connection could not be established'
            : code
              ? `the connection failed (${code})`
              : 'the connection failed'
  return `Could not reach Power BI — ${detail}. Tried ${attempts} time${attempts === 1 ? '' : 's'}.`
}

/**
 * An adaptive concurrency gate.
 *
 * Power BI rate-limits executeQueries per capacity, and the spare headroom
 * depends on what else is running on it. On a 429 the gate halves; after a run
 * of clean responses it creeps back up one at a time.
 */
const MAX_IN_FLIGHT = 8
const MIN_IN_FLIGHT = 2

let limit = MAX_IN_FLIGHT
let inFlight = 0
let cleanRun = 0
const waiting = []

function throttled() {
  limit = Math.max(MIN_IN_FLIGHT, Math.floor(limit / 2))
  cleanRun = 0
}

function succeeded() {
  if (limit >= MAX_IN_FLIGHT) return
  cleanRun++
  // Twenty clean responses before widening, so one lucky answer does not undo
  // a back-off that was correct.
  if (cleanRun >= 20) {
    limit++
    cleanRun = 0
  }
}

function acquire() {
  if (inFlight < limit) {
    inFlight++
    return Promise.resolve()
  }
  return new Promise((resolve) => waiting.push(resolve))
}

function release() {
  // Only hand the slot on if the gate has not narrowed underneath us.
  if (inFlight <= limit && waiting.length) {
    waiting.shift()()
    return
  }
  inFlight--
  if (inFlight < limit && waiting.length) {
    inFlight++
    waiting.shift()()
  }
}

/** For diagnostics: what the gate has settled on. */
export const concurrency = () => ({ limit, inFlight, waiting: waiting.length })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Run one DAX query against the semantic model.
 *
 * @param {string} dax  a complete EVALUATE statement
 * @param {object} [options]
 * @param {boolean} [options.bulk]        allow a long-running query
 * @param {string}  [options.datasetId]   defaults to PBI_DATASET_ID
 * @param {string}  [options.workspaceId] defaults to PBI_WORKSPACE_ID
 * @returns {Promise<object[]>} rows with friendly keys (see normalizeRows)
 */
export async function executeQuery(dax, { bulk = false, datasetId = null, workspaceId = null } = {}) {
  await acquire()
  // Whether this call currently occupies a slot. It gives the slot up while it
  // sleeps between attempts, so `finally` must not release it twice.
  let holding = true
  try {
    const started = Date.now()

    for (let attempt = 0; ; attempt++) {
      try {
        const rows = await sendQuery(dax, { bulk, datasetId, workspaceId })
        succeeded()
        return rows
      } catch (err) {
        const overloaded =
          err.status === 429 || (err.status === 400 && TRANSIENT_TEXT.test(err.message ?? ''))
        if (overloaded) throttled()

        const budget = overloaded ? THROTTLE_DEADLINE_MS : bulk ? BULK_TIMEOUT_MS * 3 : REQUEST_DEADLINE_MS
        const wait = err.retryAfterMs ?? RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)]
        const spent = Date.now() - started

        if (!isRetryable(err) || spent + wait >= budget) {
          // "fetch failed" tells nobody anything, and this error is shown to users.
          if (!err.status) {
            throw new HttpError(
              503,
              describeNetworkError(err, attempt + 1, bulk ? BULK_TIMEOUT_MS : REQUEST_TIMEOUT_MS),
              { cause: err }
            )
          }
          throw err
        }

        console.warn(
          `  [pbi] ${err.status === 429 ? 'throttled' : 'retrying'} attempt ${attempt + 1}, waiting ${wait}ms` +
            `${err.status ? ` (${err.status})` : ` (${err.message.slice(0, 60)})`} · gate ${limit}`
        )
        // The slot is given up while we wait: a sleeping call uses no capacity,
        // and holding it would let two sleepers close a halved gate entirely.
        holding = false
        release()
        await sleep(wait)
        await acquire()
        holding = true
      }
    }
  } finally {
    if (holding) release()
  }
}

async function sendQuery(dax, { bulk, datasetId, workspaceId }) {
  const token = await getAccessToken()
  const ws = workspaceId || config.pbi.workspaceId
  const ds = datasetId || config.pbi.datasetId
  const url = `https://api.powerbi.com/v1.0/myorg/groups/${ws}/datasets/${ds}/executeQueries`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      queries: [{ query: dax }],
      serializerSettings: { includeNulls: true },
    }),
    signal: AbortSignal.timeout(bulk ? BULK_TIMEOUT_MS : REQUEST_TIMEOUT_MS),
  })

  const text = await res.text()
  let json
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    throw new HttpError(res.status || 502, `Power BI returned a non-JSON response: ${text.slice(0, 400)}`)
  }

  if (!res.ok) {
    const err = new HttpError(res.status, describeError(res.status, json), { dax })
    const retryAfter = Number(res.headers.get('retry-after'))
    if (Number.isFinite(retryAfter) && retryAfter > 0) err.retryAfterMs = retryAfter * 1000
    throw err
  }

  const rows = json?.results?.[0]?.tables?.[0]?.rows ?? []
  return normalizeRows(rows)
}

/**
 * A plain GET against the Power BI REST API, for diagnostics. Answers
 * `{ ok, status, json }` rather than throwing, so a caller can report which
 * link in the chain failed.
 */
export async function restGet(path) {
  const token = await getAccessToken()
  const res = await fetch(`https://api.powerbi.com/v1.0/myorg${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const json = await res.json().catch(() => null)
  return { ok: res.ok, status: res.status, json }
}

/**
 * Power BI returns column keys as "Table[Column]" or "[Measure]". Strip them
 * down to the bare name. Names that collide across tables keep their prefix.
 */
export function normalizeRows(rows) {
  if (!rows.length) return []

  const keys = Object.keys(rows[0])
  const shortOf = (k) => {
    const match = /\[([^\]]+)\]\s*$/.exec(k)
    return match ? match[1] : k
  }
  const counts = {}
  for (const k of keys) {
    const s = shortOf(k)
    counts[s] = (counts[s] || 0) + 1
  }
  const rename = {}
  for (const k of keys) {
    const s = shortOf(k)
    rename[k] = counts[s] === 1 ? s : k
  }

  return rows.map((row) => {
    const out = {}
    for (const k of keys) out[rename[k]] = row[k]
    return out
  })
}

function describeError(status, json) {
  const detail =
    json?.error?.['pbi.error']?.details?.[0]?.detail?.value ||
    json?.error?.message ||
    json?.Message ||
    'unknown error'

  if (status === 401) {
    return `Power BI rejected the token (401). Check MS_CLIENT_ID/MS_CLIENT_SECRET and that the service principal has access to the workspace. Detail: ${detail}`
  }
  if (status === 403) {
    return `Power BI denied the request (403). The service principal needs Member/Contributor on the workspace, and the tenant settings "Service principals can use Fabric APIs" plus "Dataset Execute Queries REST API" must be enabled. Detail: ${detail}`
  }
  if (status === 404) {
    return `Workspace or semantic model not found (404). Check PBI_WORKSPACE_ID and PBI_DATASET_ID, and that the service principal was added to the workspace. Detail: ${detail}`
  }
  if (status === 429) {
    return `Power BI throttled the request (429). It should clear on its own — press Retry. Raise CACHE_TTL if it keeps happening. Detail: ${detail}`
  }
  return `Power BI query failed (${status}): ${detail}`
}
