import { config } from './config.js'

const store = new Map()

/**
 * How far past its TTL a value may still be served while a refresh runs behind
 * it, in TTL windows.
 *
 * The capacity answers 429 with a sixty-second Retry-After. Obeying that is
 * correct, but blocking a page on it is not: the choice is never "stale data or
 * fresh data", it is "stale data now or the same data after a minute".
 */
const STALE_WINDOWS = 4

/** Fetch, then publish the result — or keep the old one if the fetch failed. */
function refresh(key, fn, ttl) {
  const prev = store.get(key)

  const promise = Promise.resolve()
    .then(fn)
    .then(
      (value) => {
        store.set(key, { value, settled: value, hasSettled: true, expires: Date.now() + ttl })
        return value
      },
      (err) => {
        // A throttle must not also empty the cache.
        if (prev?.hasSettled) store.set(key, { ...prev, value: prev.settled })
        else store.delete(key)
        throw err
      }
    )

  // Keep the original expiry so callers arriving mid-refresh can still be
  // served the stale value sitting beside this promise.
  store.set(key, { ...prev, value: promise, refreshing: true })
  return promise
}

/**
 * Run `fn` at most once per `key` per TTL window.
 *
 * `seconds` overrides the configured lifetime for entries that need a
 * different one.
 */
export async function cached(key, fn, { seconds = null } = {}) {
  if (!config.cacheTtl && !seconds) return fn()

  const ttl = (seconds ?? config.cacheTtl) * 1000
  const now = Date.now()
  const hit = store.get(key)

  if (hit && hit.expires > now) return hit.value

  // Usable stale value: answer from it and bring the entry up to date behind
  // the request. Checked before joining an in-flight refresh, so a refresh that
  // is going to fail cannot take these callers down with it.
  if (hit?.hasSettled && now - hit.expires < ttl * (STALE_WINDOWS - 1)) {
    if (!hit.refreshing) {
      // The error already reached whoever triggered the refresh; without this
      // catch Node calls it an unhandled rejection.
      refresh(key, fn, ttl).catch(() => {})
    }
    return hit.settled
  }

  // Nothing usable to fall back on, so share one in-flight promise rather than
  // issuing a second identical query.
  if (hit?.refreshing) return hit.value

  return refresh(key, fn, ttl)
}

export function clearCache() {
  store.clear()
}
