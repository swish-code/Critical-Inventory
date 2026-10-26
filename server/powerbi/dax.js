/**
 * DAX generation helpers.
 *
 * Queries go through SUMMARIZECOLUMNS and reuse the model's OWN measures, so
 * the app returns exactly what the Power BI report shows. Table, column and
 * measure names come from the read-only pbip blueprint beside webapp/
 * (Critical Inventory Report.SemanticModel). Page-specific queries live in
 * their own module next to this one (critical.js).
 */

// --- literal escaping -------------------------------------------------------

/** A DAX literal. Numbers stay unquoted; everything else becomes a string. */
export function lit(value) {
  if (value === null || value === undefined) return 'BLANK()'
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return value ? 'TRUE()' : 'FALSE()'
  return '"' + String(value).replace(/"/g, '""') + '"'
}

/** DATE(y,m,d) from a YYYY-MM-DD string. */
export function daxDate(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number)
  return `DATE(${y},${m},${d})`
}

// --- filter arguments -------------------------------------------------------

/**
 * Filter key (as the client sends it) to model column. These are the columns
 * the report's Location and Article slicers sit on.
 */
export const COLUMN = {
  locations: 'CRITICALINVENTORY[Location]',
  articles: 'CRITICALINVENTORY[Article]',
}

/**
 * The date table column the report's date slicers sit on. Calendar[Date]
 * filters CRITICALINVENTORY[Inventory Date] and HEADER[VOUCHERDATE] through
 * the model's relationships.
 */
export const DATE_COLUMN = "'Calendar'[Date]"

/**
 * Turn the UI filter state into SUMMARIZECOLUMNS filter arguments.
 *
 * @param {object} f                    filter state from the client
 * @param {object} [options]
 * @param {object}   [options.columns]  filter key to column map (default COLUMN)
 * @param {string}   [options.dateColumn] date column (default DATE_COLUMN)
 * @param {string[]} [options.only]     restrict to these filter keys
 * @param {string[]} [options.skip]     drop these filter keys ('date' drops the range)
 */
export function filterArgs(f = {}, options = {}) {
  const { columns = COLUMN, dateColumn = DATE_COLUMN, only, skip = [] } = options
  const args = []

  for (const [key, column] of Object.entries(columns)) {
    if (only && !only.includes(key)) continue
    if (skip.includes(key)) continue
    const values = f[key]
    if (!Array.isArray(values) || values.length === 0) continue
    args.push(`TREATAS({${values.map(lit).join(', ')}}, ${column})`)
  }

  if (dateColumn && !skip.includes('date') && (f.dateFrom || f.dateTo)) {
    const from = f.dateFrom ? daxDate(f.dateFrom) : `MIN(${dateColumn})`
    const to = f.dateTo ? daxDate(f.dateTo) : `MAX(${dateColumn})`
    args.push(`TREATAS(CALENDAR(${from}, ${to}), ${dateColumn})`)
  }

  return args
}

/** Join group-by columns, filters and measures into one SUMMARIZECOLUMNS. */
export function summarize({ groupBy = [], filters = [], measures = [] }) {
  const parts = [...groupBy, ...filters, ...measures.map(([name, expr]) => `${lit(name)}, ${expr}`)]
  return `SUMMARIZECOLUMNS(\n  ${parts.join(',\n  ')}\n)`
}

/** A complete query from a table expression. */
export const evaluate = (table) => `EVALUATE\n${table}`
