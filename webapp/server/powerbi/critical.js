import { evaluate, filterArgs, summarize } from './dax.js'

/**
 * Queries for the Critical Inventory report pages.
 *
 * Every figure comes from the model: the cards use its own measures, and the
 * table uses SUM over the same columns the report's table aggregates (it has no
 * measures of its own). Totals are separate DAX queries rather than sums in
 * JavaScript, so they are exactly what Power BI's totals row shows.
 *
 * Output names are prefixed (k_, q_) because SUMMARIZECOLUMNS refuses a name
 * that is already a measure in the model — "Purchase" is one.
 */

const T = 'CRITICALINVENTORY'
const col = (name) => `${T}[${name}]`

/** The report's cards on the Daily Critical Report page, in display order. */
export const DAILY_KPIS = [
  ['itemsChecked', '[Items Checked]'],
  ['itemsWithVariance', '[Items with Variance]'],
  ['netVariance', '[Net Variance]'],
  ['shortageValue', '[Shortage Value (KD)]'],
  ['surplusValue', '[Surplus Value (KD)]'],
  ['netVarianceValue', '[Net Variance (KD)]'],
]

/** The report's table columns: client key and the model column it sums. */
export const DAILY_COLUMNS = [
  ['opening', 'Opening'],
  ['purchase', 'Purchase'],
  ['transferIn', 'Transfer In'],
  ['transferOut', 'Transfer Out'],
  ['wastage', 'Usage'],
  ['closing', 'Closing'],
  ['calcPot', 'Calc POT'],
  ['variance', 'Deviation'],
  ['varianceValue', 'Deviation Value'],
]

const dailySums = () => DAILY_COLUMNS.map(([key, column]) => [`q_${key}`, `SUM(${col(column)})`])

/* ---------------------------------------------------------------- slicers -- */

/**
 * Values for one slicer, narrowed by every OTHER slicer — Power BI's slicers
 * cross-filter each other the same way. [Rows Counted] keeps only values that
 * actually have rows under those filters.
 */
function optionsQuery(column, f) {
  return (
    evaluate(
      summarize({
        groupBy: [col(column)],
        filters: filterArgs(f),
        measures: [['n', '[Rows Counted]']],
      })
    ) + `\nORDER BY ${col(column)}`
  )
}

/**
 * Location options ignore the location slicer itself, but never go beyond the
 * locations this user may see (`scope`, null for all of them).
 */
export const locationOptionsQuery = (f, scope = null) => optionsQuery('Location', { ...f, locations: scope ?? [] })
export const articleOptionsQuery = (f) => optionsQuery('Article', { ...f, articles: [] })

/** Every location in the model, for the Admin page's access picker. */
export const allLocationsQuery = () => optionsQuery('Location', {})

/** The full extent of the Calendar table, for the date range control. */
export const dateBoundsQuery = () =>
  evaluate(`ROW("minDate", MIN('Calendar'[Date]), "maxDate", MAX('Calendar'[Date]))`)

/* ------------------------------------------------- Daily Critical Report -- */

export const dailyKpisQuery = (f) =>
  evaluate(
    summarize({
      filters: filterArgs(f),
      measures: DAILY_KPIS.map(([key, measure]) => [`k_${key}`, measure]),
    })
  )

/** One row per inventory date, item and unit — the report's table grain. */
export const dailyTableQuery = (f) =>
  evaluate(
    summarize({
      groupBy: [col('Inventory Date'), col('Article'), col('Base Unit')],
      filters: filterArgs(f),
      measures: dailySums(),
    })
  ) + `\nORDER BY ${col('Inventory Date')} DESC, ${col('Article')} ASC`

/** The table's totals row: the same sums with no grouping. */
export const dailyTotalsQuery = (f) =>
  evaluate(summarize({ filters: filterArgs(f), measures: dailySums() }))

/* ------------------------------------------ Summary - Critical Inventory -- */

/**
 * The report's matrix: Article rows, Calendar date columns, Sum of Deviation.
 *
 * ROLLUPADDISSUBTOTAL makes the model return the row totals, the column totals
 * and the grand total in the same answer, flagged by s_isArticleTotal and
 * s_isDateTotal, so no total is ever added up in the browser. The matrix is
 * saved collapsed at Article level, so Base Unit is not a grouping here.
 */
export const summaryMatrixQuery = (f) =>
  evaluate(
    summarize({
      groupBy: [
        `ROLLUPADDISSUBTOTAL(${col('Article')}, "s_isArticleTotal")`,
        `ROLLUPADDISSUBTOTAL('Calendar'[Date], "s_isDateTotal")`,
      ],
      filters: filterArgs(f),
      measures: [['s_variance', `SUM(${col('Deviation')})`]],
    })
  )

/** Each article's unit(s), shown beside its name (the matrix's collapsed level). */
export const summaryUnitsQuery = (f) =>
  evaluate(
    summarize({
      groupBy: [col('Article'), col('Base Unit')],
      filters: filterArgs(f),
      measures: [['n', '[Rows Counted]']],
    })
  )

export function shapeMatrix(cells, units) {
  const unitsOf = new Map()
  for (const u of units) {
    if (!u.Article || !u['Base Unit']) continue
    const list = unitsOf.get(u.Article) ?? []
    list.push(u['Base Unit'])
    unitsOf.set(u.Article, list)
  }

  const rows = new Map()
  const columnTotals = {}
  const dates = new Set()
  let grandTotal = null

  for (const c of cells) {
    const articleTotal = Boolean(c.s_isArticleTotal)
    const dateTotal = Boolean(c.s_isDateTotal)
    const date = day(c.Date)
    const v = c.s_variance ?? null
    if (articleTotal && dateTotal) {
      grandTotal = v
    } else if (articleTotal) {
      columnTotals[date] = v
      dates.add(date)
    } else {
      const row = rows.get(c.Article) ?? { article: c.Article, units: (unitsOf.get(c.Article) ?? []).join(', '), total: null, cells: {} }
      if (dateTotal) row.total = v
      else {
        row.cells[date] = v
        dates.add(date)
      }
      rows.set(c.Article, row)
    }
  }

  return {
    dates: [...dates].filter(Boolean).sort(),
    rows: [...rows.values()].sort((a, b) => String(a.article).localeCompare(String(b.article))),
    columnTotals,
    grandTotal,
  }
}

/* ----------------------------------------------------- Comparison Report -- */

/** The report's table columns, in order, with the model measure behind each. */
export const COMPARISON = [
  ['rows', '[Rows Counted]'],
  ['salesKd', '[Sales KD]'],
  ['actualVarianceKd', '[Actual Variance KD]'],
  ['actualVariancePct', '[Actual Variance %]'],
  ['targetVarianceKd', '[Target Variance KD]'],
  ['targetVariancePct', '[Target Variance % Value]'],
  ['variancePct', '[Variance %]'],
  ['varianceKd', '[Variance KD]'],
]

/**
 * The TARGET VARIANCE % slicer, reproduced exactly: it is a "Before" slicer, so
 * it keeps Value <= target, and the measure reads MAX(Value) / 100. No target
 * means no filter, which the measure turns into its 0.5% default.
 */
const targetArgs = (target) =>
  target === null || target === undefined
    ? []
    : [`FILTER(ALL('Target Variance %'[Value]), 'Target Variance %'[Value] <= ${Number(target)})`]

const comparisonMeasures = () => COMPARISON.map(([key, measure]) => [`c_${key}`, measure])

/**
 * One row per date. The report's visual-level filter "Rows Counted is not
 * blank" keeps only the days on which counts happened.
 */
export const comparisonQuery = (f, target) =>
  `EVALUATE\nFILTER(\n${summarize({
    groupBy: ["'Calendar'[Date]"],
    filters: [...filterArgs(f), ...targetArgs(target)],
    measures: comparisonMeasures(),
  })},\nNOT ISBLANK([c_rows])\n)\nORDER BY 'Calendar'[Date]`

/**
 * The totals row: the same measures over exactly the dates the table shows —
 * which is what Power BI's total does when a visual-level filter hides rows.
 */
export function comparisonTotalsQuery(f, target) {
  const filters = filterArgs(f)
  const withFilters = (expr, extra = []) => [expr, ...filters, ...extra].join(',\n  ')
  return [
    'EVALUATE',
    'VAR __dates =',
    `  CALCULATETABLE(\n  ${withFilters("FILTER(VALUES('Calendar'[Date]), NOT ISBLANK([Rows Counted]))")}\n  )`,
    'RETURN',
    `  CALCULATETABLE(\n  ${withFilters(
      `ROW(${comparisonMeasures().map(([n, m]) => `"${n}", ${m}`).join(', ')})`,
      ['__dates', ...targetArgs(target)]
    )}\n  )`,
  ].join('\n')
}

/* ------------------------------------------------------- row shaping -- */

/** Power BI dates come back as ISO date-times; the UI only wants the day. */
export const day = (v) => (typeof v === 'string' ? v.slice(0, 10) : v ?? null)

/** Drops the k_/q_ prefixes; a missing row (all blank) becomes nulls. */
export function unprefix(row, keys, prefix) {
  const out = {}
  for (const [key] of keys) out[key] = row?.[`${prefix}${key}`] ?? null
  return out
}

export function shapeDailyRow(r) {
  return {
    date: day(r['Inventory Date']),
    article: r.Article ?? null,
    unit: r['Base Unit'] ?? null,
    ...unprefix(r, DAILY_COLUMNS, 'q_'),
  }
}
