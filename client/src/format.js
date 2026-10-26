/**
 * Display formats, agreed against the Power BI report:
 *   counts 0 decimals · quantities 2 · KD 3 · percentages 2.
 * Blank (null) shows as an en dash, the way Power BI shows "(Blank)" as empty.
 */

const BLANK = '–'
const isBlank = (v) => v === null || v === undefined || v === '' || Number.isNaN(Number(v))

const fixed = (digits) =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })

const INT = fixed(0)
const QTY = fixed(2)
const KD = fixed(3)
const PCT = fixed(2)

/** Avoids "-0.00": a value that rounds to zero shows without a sign. */
function signed(fmt, v) {
  const s = fmt.format(Number(v))
  return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s
}

export const fmtCount = (v) => (isBlank(v) ? BLANK : signed(INT, v))
export const fmtQty = (v) => (isBlank(v) ? BLANK : signed(QTY, v))
export const fmtKdNumber = (v) => (isBlank(v) ? BLANK : signed(KD, v))
export const fmtKd = (v) => (isBlank(v) ? BLANK : `KD ${signed(KD, v)}`)
/** Takes a ratio: 0.1 → "10.00%". */
export const fmtPct = (v) => (isBlank(v) ? BLANK : `${signed(PCT, Number(v) * 100)}%`)

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-10-17" → "17 Oct 2026". */
export function fmtDate(iso) {
  if (!iso) return BLANK
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number)
  return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`
}

/** "2026-10-17" → "17 Oct". */
export function fmtDay(iso) {
  if (!iso) return BLANK
  const [, m, d] = String(iso).slice(0, 10).split('-').map(Number)
  return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]}`
}

/** The label for a date range, as shown on tags and in file names. */
export function periodLabel(from, to) {
  if (!from && !to) return 'All dates'
  if (from && to && from === to) return fmtDate(from)
  return `${from ? fmtDay(from) : 'Start'} – ${to ? fmtDate(to) : 'Latest'}`
}

/** Positive / negative / neutral, for colouring signed figures. */
export const tone = (v) => (isBlank(v) || Math.abs(Number(v)) < 1e-9 ? 'neutral' : Number(v) < 0 ? 'neg' : 'pos')

/** "just now", "1 min ago", "12 mins ago", "2 hours ago". */
export function relativeTime(ts, now = Date.now()) {
  if (!ts) return ''
  const mins = Math.floor((now - ts) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

/** "14s ago", "3m ago", "2h ago", "1d ago" — compact, for feeds and tables. */
export function shortAgo(ts, now = Date.now()) {
  if (!ts) return '–'
  const s = Math.max(0, Math.floor((now - ts) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86_400)}d ago`
}

/** Active minutes as "11m" or "24h 42m". */
export function fmtDuration(minutes) {
  if (minutes === null || minutes === undefined || Number.isNaN(Number(minutes))) return '–'
  const m = Math.round(Number(minutes))
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`
}

/** A Kuwait-time timestamp as "25 Oct, 11:17 am". */
export function fmtStamp(ts) {
  if (!ts) return '–'
  const d = new Date(ts + 3 * 3_600_000)
  const h = d.getUTCHours()
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]}, ${((h + 11) % 12) + 1}:${mm} ${h < 12 ? 'am' : 'pm'}`
}
