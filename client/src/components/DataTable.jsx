import { useEffect, useMemo, useState } from 'react'
import { downloadCsv } from '../csv.js'
import { Change } from './Change.jsx'
import { IconDownload, IconSearch } from './Icons.jsx'
import { Tooltip } from './Tooltip.jsx'
import { Empty } from './ui.jsx'

/**
 * A sortable, searchable, paginated table.
 *
 * columns: [{ key, label, num?, format?(v, row), signed?, width?, strong?, hint? }]
 *   hint    a tooltip on the column header explaining the figure
 *   num     right-aligned with tabular figures
 *   format  how a value is displayed (raw values are kept for sorting and CSV)
 *   signed  shows the value as a green (positive) or red (negative) pill
 *
 * `totals` is a row keyed like `rows`, computed by the model — never summed
 * here — so it is exactly the report's totals row. It covers every row for the
 * current filters, whatever the search box is showing.
 */
export function DataTable({
  columns,
  rows = [],
  totals = null,
  initialSort = null,
  pageSizes = [50, 100, 250, 'All'],
  exportName = null,
  searchPlaceholder = 'Search…',
  maxHeight = 640,
}) {
  const [sort, setSort] = useState(initialSort)
  const [query, setQuery] = useState('')
  const [pageSize, setPageSize] = useState(pageSizes[0])
  const [page, setPage] = useState(0)

  // Search matches text columns as they are displayed, so "17 Oct" finds a date.
  // A column whose display is not plain text (a name with an email under it)
  // is searched on its raw value plus any `searchKeys` it names.
  const textCols = useMemo(() => columns.filter((c) => !c.num && c.search !== false), [columns])

  const matched = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    const shown = (c, r) => {
      const v = c.format ? c.format(r[c.key], r) : r[c.key]
      const text = typeof v === 'string' || typeof v === 'number' ? String(v) : String(r[c.key] ?? '')
      return [text, ...(c.searchKeys ?? []).map((k) => String(r[k] ?? ''))].join(' ')
    }
    return rows.filter((r) => textCols.some((c) => shown(c, r).toLowerCase().includes(q)))
  }, [rows, query, textCols])

  const sorted = useMemo(() => {
    if (!sort) return matched
    const { key, dir } = sort
    const mul = dir === 'asc' ? 1 : -1
    const col = columns.find((c) => c.key === key)
    return [...matched].sort((a, b) => {
      const x = a[key]
      const y = b[key]
      // Blanks always sort last, whichever way the column is ordered.
      if (x === null || x === undefined || x === '') return y === null || y === undefined || y === '' ? 0 : 1
      if (y === null || y === undefined || y === '') return -1
      if (col?.num) return (Number(x) - Number(y)) * mul
      return String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' }) * mul
    })
  }, [matched, sort, columns])

  const size = pageSize === 'All' ? sorted.length || 1 : pageSize
  const pages = Math.max(1, Math.ceil(sorted.length / size))
  const current = Math.min(page, pages - 1)
  const visible = sorted.slice(current * size, current * size + size)

  // A new search, sort or data set starts again from the first page.
  useEffect(() => setPage(0), [query, sort, rows, pageSize])

  const sortBy = (key) =>
    setSort((s) => (s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }))

  const text = (c, r) => (c.format ? c.format(r[c.key], r) : (r[c.key] ?? '–'))
  const cell = (c, r) => (c.signed ? <Change value={r[c.key]} text={text(c, r)} /> : text(c, r))
  const cls = (c) => [c.num && 'num', c.strong && 'strong'].filter(Boolean).join(' ') || undefined

  const from = sorted.length ? current * size + 1 : 0
  const to = Math.min(sorted.length, (current + 1) * size)

  return (
    <div className="dt">
      <div className="dt__bar">
        <label className="search">
          <IconSearch size={15} />
          <input
            type="search"
            placeholder={searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search the table"
          />
        </label>
        {query && (
          <span className="dt__count">
            {matched.length.toLocaleString('en-US')} match{matched.length === 1 ? '' : 'es'}
          </span>
        )}
        <span className="dt__spacer" />
        <label className="dt__size">
          <span>Rows</span>
          <select value={pageSize} onChange={(e) => setPageSize(e.target.value === 'All' ? 'All' : Number(e.target.value))}>
            {pageSizes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        {exportName && (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => downloadCsv(exportName, columns, sorted, query ? null : totals)}
            disabled={!sorted.length}
            title={query ? 'Exports the matching rows (without the totals row, which covers all rows)' : 'Exports every row and the totals row'}
          >
            <IconDownload size={15} />
            Export CSV
          </button>
        )}
      </div>

      {!rows.length ? (
        <Empty />
      ) : (
        <div className="dt__scroll" style={{ maxHeight }}>
          <table>
            <thead>
              <tr>
                {columns.map((c) => {
                  const on = sort?.key === c.key
                  return (
                    <th
                      key={c.key}
                      className={c.num ? 'num' : undefined}
                      style={c.width ? { minWidth: c.width } : undefined}
                      aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    >
                      <Tooltip text={c.hint}>
                        <button type="button" className={`dt__sort${on ? ' dt__sort--on' : ''}`} onClick={() => sortBy(c.key)}>
                          {c.label}
                          <span className="dt__arrow" aria-hidden="true">
                            {on ? (sort.dir === 'asc' ? '▴' : '▾') : '⇅'}
                          </span>
                        </button>
                      </Tooltip>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {visible.map((r, i) => (
                <tr key={i}>
                  {columns.map((c) => (
                    <td key={c.key} className={cls(c)}>
                      {cell(c, r)}
                    </td>
                  ))}
                </tr>
              ))}
              {!visible.length && (
                <tr>
                  <td colSpan={columns.length} className="dt__none">
                    No rows match “{query}”.
                  </td>
                </tr>
              )}
            </tbody>
            {totals && (
              <tfoot>
                <tr>
                  {columns.map((c, i) => (
                    <td key={c.key} className={cls(c)}>
                      {i === 0 ? 'Total' : c.num ? cell(c, totals) : ''}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {rows.length > 0 && (
        <div className="dt__pager">
          <span>
            {from.toLocaleString('en-US')}–{to.toLocaleString('en-US')} of {sorted.length.toLocaleString('en-US')}
            {query && totals ? ' · the total row covers all rows for the filters' : ''}
          </span>
          <span className="dt__spacer" />
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setPage(0)} disabled={current === 0}>
            First
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setPage(current - 1)} disabled={current === 0}>
            Prev
          </button>
          <span className="dt__page">
            Page {current + 1} / {pages}
          </span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setPage(current + 1)} disabled={current >= pages - 1}>
            Next
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setPage(pages - 1)} disabled={current >= pages - 1}>
            Last
          </button>
        </div>
      )}
    </div>
  )
}
