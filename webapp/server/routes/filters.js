/**
 * The filter state a page sends, reduced to what the queries accept.
 *
 * Everything here ends up inside a DAX string. lit() escapes the values, and
 * this keeps the shape honest: only known keys, only strings in the lists,
 * only real calendar days in the dates. An empty list means "no filter", as in
 * Power BI.
 */

const MAX_VALUES = 2000
const MAX_LENGTH = 300

/**
 * Matches no location, for a user whose selection falls entirely outside their
 * access. Plain printable text: DAX rejects control characters as a syntax
 * error, which would show the user a failure instead of an empty result.
 */
export const NO_LOCATION = '[no location access]'

const list = (v) =>
  Array.isArray(v)
    ? [...new Set(v.filter((x) => typeof x === 'string' && x.length > 0 && x.length <= MAX_LENGTH))]
        .slice(0, MAX_VALUES)
        .sort()
    : []

function isoDay(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  const d = new Date(`${v}T00:00:00Z`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v
}

export function parseFilters(body = {}) {
  const b = body && typeof body === 'object' ? body : {}
  let dateFrom = isoDay(b.dateFrom)
  let dateTo = isoDay(b.dateTo)
  if (dateFrom && dateTo && dateFrom > dateTo) [dateFrom, dateTo] = [dateTo, dateFrom]
  return { locations: list(b.locations), articles: list(b.articles), dateFrom, dateTo }
}

/**
 * The Comparison page's target: a number from 0 to 100 (the slicer's range),
 * or null for "no target set", which the model turns into its 0.5% default.
 */
export function parseTarget(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0 || n > 100) return null
  return Math.round(n * 100) / 100
}

/**
 * Applies a user's location access to the filters.
 *
 * No restriction: unchanged. Otherwise the selection is narrowed to the allowed
 * locations, and an empty selection becomes "all the allowed locations" — so a
 * restricted user's "All locations" means all of theirs, never everyone's.
 */
export function applyScope(f, user) {
  const allowed = user?.locations
  if (!Array.isArray(allowed)) return { filters: f, scope: null }
  const picked = f.locations.length ? f.locations.filter((l) => allowed.includes(l)) : [...allowed]
  return { filters: { ...f, locations: picked.length ? picked.sort() : [NO_LOCATION] }, scope: [...allowed].sort() }
}

/** A stable cache key: the same filters always produce the same string. */
export const filterKey = (f) => JSON.stringify(f)
