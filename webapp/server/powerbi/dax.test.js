import { test } from 'node:test'
import assert from 'node:assert/strict'
import { daxDate, evaluate, filterArgs, lit, summarize } from './dax.js'

test('lit escapes strings and keeps numbers, booleans and blanks native', () => {
  assert.equal(lit('a"b'), '"a""b"')
  assert.equal(lit(42), '42')
  assert.equal(lit(true), 'TRUE()')
  assert.equal(lit(null), 'BLANK()')
  assert.equal(lit(Number.NaN), '"NaN"')
})

test('daxDate builds DATE() from an ISO day', () => {
  assert.equal(daxDate('2026-03-07'), 'DATE(2026,3,7)')
  assert.equal(daxDate('2026-03-07T00:00:00Z'), 'DATE(2026,3,7)')
})

test('filterArgs maps filter keys through the column map and skips empties', () => {
  const columns = { sites: "'Site'[Code]", items: "'Item'[Id]" }
  const args = filterArgs({ sites: ['A', 'B'], items: [] }, { columns })
  assert.deepEqual(args, ["TREATAS({\"A\", \"B\"}, 'Site'[Code])"])
})

test('filterArgs honours only/skip and the date range', () => {
  const columns = { sites: "'Site'[Code]", items: "'Item'[Id]" }
  const f = { sites: ['A'], items: [1], dateFrom: '2026-01-01', dateTo: '2026-01-31' }
  assert.deepEqual(filterArgs(f, { columns, only: ['items'], skip: ['date'] }), ["TREATAS({1}, 'Item'[Id])"])
  const withDate = filterArgs(f, { columns, skip: ['sites', 'items'], dateColumn: "'Date'[Date]" })
  assert.deepEqual(withDate, ["TREATAS(CALENDAR(DATE(2026,1,1), DATE(2026,1,31)), 'Date'[Date])"])
  assert.deepEqual(filterArgs(f, { columns: {}, dateColumn: "'Date'[Date]", skip: ['date'] }), [])
})

test('filterArgs uses the model\'s slicer columns by default and ignores unknown keys', () => {
  const args = filterArgs({ locations: ['MM-Jahra'], anything: ['x'], dateFrom: '2026-10-01', dateTo: '2026-10-07' })
  assert.deepEqual(args, [
    'TREATAS({"MM-Jahra"}, CRITICALINVENTORY[Location])',
    "TREATAS(CALENDAR(DATE(2026,10,1), DATE(2026,10,7)), 'Calendar'[Date])",
  ])
})

test('summarize and evaluate compose a query', () => {
  const q = evaluate(summarize({ groupBy: ["'Site'[Code]"], measures: [['Qty', '[Total Qty]']] }))
  assert.equal(q, "EVALUATE\nSUMMARIZECOLUMNS(\n  'Site'[Code],\n  \"Qty\", [Total Qty]\n)")
})
