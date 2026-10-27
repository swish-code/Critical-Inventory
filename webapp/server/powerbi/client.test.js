import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeRows } from './client.js'

test('normalizeRows strips table prefixes to bare names', () => {
  const rows = [{ "'Site'[Code]": 'A', '[Qty]': 3 }]
  assert.deepEqual(normalizeRows(rows), [{ Code: 'A', Qty: 3 }])
})

test('normalizeRows keeps the prefix when two tables share a column name', () => {
  const rows = [{ "'Site'[Name]": 'A', "'Item'[Name]": 'B' }]
  assert.deepEqual(normalizeRows(rows), [{ "'Site'[Name]": 'A', "'Item'[Name]": 'B' }])
})

test('normalizeRows handles an empty result', () => {
  assert.deepEqual(normalizeRows([]), [])
})
