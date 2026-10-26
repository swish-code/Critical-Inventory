import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as q from './critical.js'
import { parseFilters } from '../routes/filters.js'

const none = parseFilters({})
const some = parseFilters({ locations: ['MM-Jahra'], articles: ['Chicken "A"'], dateFrom: '2026-10-07', dateTo: '2026-10-01' })

test('parseFilters keeps known keys, valid days and strings only, and orders the range', () => {
  assert.deepEqual(none, { locations: [], articles: [], dateFrom: null, dateTo: null })
  assert.deepEqual(some, { locations: ['MM-Jahra'], articles: ['Chicken "A"'], dateFrom: '2026-10-01', dateTo: '2026-10-07' })
  assert.deepEqual(
    parseFilters({ locations: [1, '', 'B', 'A', 'B'], dateFrom: '2026-02-30', evil: 'x' }),
    { locations: ['A', 'B'], articles: [], dateFrom: null, dateTo: null }
  )
})

test('the KPI query asks for all six report measures under the filters', () => {
  const dax = q.dailyKpisQuery(some)
  for (const m of ['[Items Checked]', '[Items with Variance]', '[Net Variance]', '[Shortage Value (KD)]', '[Surplus Value (KD)]', '[Net Variance (KD)]']) {
    assert.ok(dax.includes(m), m)
  }
  assert.ok(dax.includes('TREATAS({"MM-Jahra"}, CRITICALINVENTORY[Location])'))
  assert.ok(dax.includes('TREATAS({"Chicken ""A"""}, CRITICALINVENTORY[Article])'), 'quotes are escaped')
  assert.ok(dax.includes("TREATAS(CALENDAR(DATE(2026,10,1), DATE(2026,10,7)), 'Calendar'[Date])"))
})

test('with no filters the KPI query has no filter arguments', () => {
  assert.ok(!q.dailyKpisQuery(none).includes('TREATAS'))
})

test('the table groups at the report grain and sums the report columns', () => {
  const dax = q.dailyTableQuery(none)
  assert.ok(dax.includes('CRITICALINVENTORY[Inventory Date],\n  CRITICALINVENTORY[Article],\n  CRITICALINVENTORY[Base Unit]'))
  assert.ok(dax.includes('"q_wastage", SUM(CRITICALINVENTORY[Usage])'))
  assert.ok(dax.includes('"q_variance", SUM(CRITICALINVENTORY[Deviation])'))
  assert.ok(dax.endsWith('ORDER BY CRITICALINVENTORY[Inventory Date] DESC, CRITICALINVENTORY[Article] ASC'))
  assert.ok(!q.dailyTotalsQuery(none).includes('CRITICALINVENTORY[Inventory Date]'), 'totals are ungrouped')
})

test('slicer options are narrowed by the other slicers, not by themselves', () => {
  const loc = q.locationOptionsQuery(some)
  assert.ok(!loc.includes('CRITICALINVENTORY[Location])'), 'location options ignore the location filter')
  assert.ok(loc.includes('CRITICALINVENTORY[Article])'))
  const art = q.articleOptionsQuery(some)
  assert.ok(art.includes('CRITICALINVENTORY[Location])'))
  assert.ok(!art.includes('TREATAS({"Chicken'))
})

test('location options stay inside a user\'s location access', () => {
  assert.ok(q.locationOptionsQuery(none, ['A', 'B']).includes('TREATAS({"A", "B"}, CRITICALINVENTORY[Location])'))
  assert.ok(!q.locationOptionsQuery(some, null).includes('CRITICALINVENTORY[Location])'))
})

test('the matrix query asks the model for every subtotal', () => {
  const dax = q.summaryMatrixQuery(some)
  assert.ok(dax.includes('ROLLUPADDISSUBTOTAL(CRITICALINVENTORY[Article], "s_isArticleTotal")'))
  assert.ok(dax.includes(`ROLLUPADDISSUBTOTAL('Calendar'[Date], "s_isDateTotal")`))
  assert.ok(dax.includes('SUM(CRITICALINVENTORY[Deviation])'))
})

test('shapeMatrix lays out cells, row totals, column totals and the grand total', () => {
  const cells = [
    { Article: 'B', Date: '2026-10-02T00:00:00', s_variance: 2, s_isArticleTotal: false, s_isDateTotal: false },
    { Article: 'A', Date: '2026-10-01T00:00:00', s_variance: -1, s_isArticleTotal: false, s_isDateTotal: false },
    { Article: 'A', Date: null, s_variance: -1, s_isArticleTotal: false, s_isDateTotal: true },
    { Article: 'B', Date: null, s_variance: 2, s_isArticleTotal: false, s_isDateTotal: true },
    { Article: null, Date: '2026-10-01T00:00:00', s_variance: -1, s_isArticleTotal: true, s_isDateTotal: false },
    { Article: null, Date: '2026-10-02T00:00:00', s_variance: 2, s_isArticleTotal: true, s_isDateTotal: false },
    { Article: null, Date: null, s_variance: 1, s_isArticleTotal: true, s_isDateTotal: true },
  ]
  const m = q.shapeMatrix(cells, [{ Article: 'A', 'Base Unit': 'KG' }])
  assert.deepEqual(m.dates, ['2026-10-01', '2026-10-02'])
  assert.deepEqual(m.rows.map((r) => r.article), ['A', 'B'])
  assert.deepEqual(m.rows[0], { article: 'A', units: 'KG', total: -1, cells: { '2026-10-01': -1 } })
  assert.deepEqual(m.columnTotals, { '2026-10-01': -1, '2026-10-02': 2 })
  assert.equal(m.grandTotal, 1)
})

test('the comparison query reproduces the target slicer and the "Rows Counted is not blank" filter', () => {
  const dax = q.comparisonQuery(none, 10)
  assert.ok(dax.includes(`FILTER(ALL('Target Variance %'[Value]), 'Target Variance %'[Value] <= 10)`))
  assert.ok(dax.includes('NOT ISBLANK([c_rows])'))
  for (const m of ['[Sales KD]', '[Actual Variance KD]', '[Actual Variance %]', '[Target Variance KD]', '[Target Variance % Value]', '[Variance %]', '[Variance KD]']) {
    assert.ok(dax.includes(m), m)
  }
  assert.ok(!q.comparisonQuery(none, null).includes('Target Variance %\'[Value] <='), 'no target means no filter')
  const totals = q.comparisonTotalsQuery(some, 10)
  assert.ok(totals.includes('__dates'))
  assert.ok(totals.includes("TREATAS(CALENDAR(DATE(2026,10,1), DATE(2026,10,7)), 'Calendar'[Date])"))
})

test('rows are reshaped to plain keys, and a blank result becomes nulls', () => {
  const row = q.shapeDailyRow({ 'Inventory Date': '2026-10-17T00:00:00', Article: 'X', 'Base Unit': 'KG', q_opening: 5, q_variance: -1 })
  assert.equal(row.date, '2026-10-17')
  assert.equal(row.opening, 5)
  assert.equal(row.variance, -1)
  assert.equal(row.purchase, null)
  assert.deepEqual(q.unprefix(undefined, q.DAILY_KPIS, 'k_').itemsChecked, null)
})
