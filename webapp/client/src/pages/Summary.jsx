import { useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import { IconDownload, IconSearch } from '../components/Icons.jsx'
import { Empty, ErrorBanner, Panel } from '../components/ui.jsx'
import { downloadCsv, exportFileName } from '../csv.js'
import { Change } from '../components/Change.jsx'
import { fmtDay, fmtQty } from '../format.js'
import { useData } from '../useData.js'

const PAGE_SIZES = [50, 100, 250, 'All']

/**
 * Summary - Critical Inventory.
 *
 * The report's matrix: one row per item (saved collapsed at Article level, so
 * the unit is shown beside the name rather than as its own row), one column per
 * count day, Sum of Deviation in the cells. Every total — each row's, each
 * day's and the grand total — is the model's own, from ROLLUPADDISSUBTOTAL.
 */
export function Summary({ filters, period, nonce, onLoaded }) {
  const matrix = useData(api.summaryMatrix, filters, { nonce, onLoaded })
  const m = matrix.data

  const [query, setQuery] = useState('')
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0])
  const [page, setPage] = useState(0)
  const [sortByTotal, setSortByTotal] = useState(null) // null = by item name, as in the report

  const rows = useMemo(() => {
    if (!m) return []
    const q = query.trim().toLowerCase()
    const matched = q ? m.rows.filter((r) => `${r.article} ${r.units}`.toLowerCase().includes(q)) : m.rows
    if (!sortByTotal) return matched
    const mul = sortByTotal === 'asc' ? 1 : -1
    return [...matched].sort((a, b) => ((a.total ?? 0) - (b.total ?? 0)) * mul)
  }, [m, query, sortByTotal])

  useEffect(() => setPage(0), [query, sortByTotal, m, pageSize])

  const size = pageSize === 'All' ? rows.length || 1 : pageSize
  const pages = Math.max(1, Math.ceil(rows.length / size))
  const current = Math.min(page, pages - 1)
  const visible = rows.slice(current * size, current * size + size)

  const exportCsv = () => {
    const columns = [
      { key: 'article', label: 'Item Name' },
      { key: 'units', label: 'Unit' },
      ...m.dates.map((d) => ({ key: d, label: d })),
      { key: 'total', label: 'Total' },
    ]
    const flat = rows.map((r) => ({ article: r.article, units: r.units, total: r.total, ...r.cells }))
    const totals = query ? null : { article: 'Total', units: '', total: m.grandTotal, ...m.columnTotals }
    downloadCsv(exportFileName('Critical Inventory Summary', period), columns, flat, totals)
  }

  /** Blank stays empty, as in the report's matrix; anything else is a signed pill. */
  const cell = (v) => (v === null || v === undefined ? '' : <Change value={v} text={fmtQty(v)} />)

  return (
    <Panel
      title="Variance by item and day"
      tag={m ? `${m.rows.length.toLocaleString('en-US')} items · ${m.dates.length} days` : null}
      busy={matrix.loading && Boolean(m)}
    >
      <ErrorBanner error={matrix.error} onRetry={matrix.reload} />
      {matrix.loading && !m && <div className="skel skel--table" aria-busy="true" />}
      {m && !m.rows.length && <Empty />}
      {m && m.rows.length > 0 && (
        <div className="dt">
          <div className="dt__bar">
            <label className="search">
              <IconSearch size={15} />
              <input
                type="search"
                placeholder="Search item or unit"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search items"
              />
            </label>
            {query && <span className="dt__count">{rows.length.toLocaleString('en-US')} matches</span>}
            <span className="dt__spacer" />
            <label className="dt__size">
              <span>Rows</span>
              <select value={pageSize} onChange={(e) => setPageSize(e.target.value === 'All' ? 'All' : Number(e.target.value))}>
                {PAGE_SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn btn--ghost btn--sm" onClick={exportCsv}>
              <IconDownload size={15} />
              Export CSV
            </button>
          </div>

          <div className="dt__scroll matrix" style={{ maxHeight: 680 }}>
            <table>
              <thead>
                <tr>
                  <th className="matrix__item">
                    <button
                      type="button"
                      className={`dt__sort${!sortByTotal ? ' dt__sort--on' : ''}`}
                      onClick={() => setSortByTotal(null)}
                    >
                      Item Name
                      <span className="dt__arrow" aria-hidden="true">
                        {!sortByTotal ? '▴' : '⇅'}
                      </span>
                    </button>
                  </th>
                  {m.dates.map((d) => (
                    <th key={d} className="num" title={d}>
                      {fmtDay(d)}
                    </th>
                  ))}
                  <th className="num matrix__total">
                    <button
                      type="button"
                      className={`dt__sort${sortByTotal ? ' dt__sort--on' : ''}`}
                      onClick={() => setSortByTotal((s) => (s === 'asc' ? 'desc' : 'asc'))}
                    >
                      Total
                      <span className="dt__arrow" aria-hidden="true">
                        {sortByTotal === 'asc' ? '▴' : sortByTotal === 'desc' ? '▾' : '⇅'}
                      </span>
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.article}>
                    <td className="matrix__item strong">
                      <span className="matrix__name">{r.article}</span>
                      {r.units && <span className="matrix__unit">{r.units}</span>}
                    </td>
                    {m.dates.map((d) => (
                      <td key={d} className="num">
                        {cell(r.cells[d])}
                      </td>
                    ))}
                    <td className="num matrix__total strong">{cell(r.total)}</td>
                  </tr>
                ))}
                {!visible.length && (
                  <tr>
                    <td colSpan={m.dates.length + 2} className="dt__none">
                      No items match “{query}”.
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td className="matrix__item">Total</td>
                  {m.dates.map((d) => (
                    <td key={d} className="num">
                      {cell(m.columnTotals[d])}
                    </td>
                  ))}
                  <td className="num matrix__total">{cell(m.grandTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="dt__pager">
            <span>
              {rows.length ? (current * size + 1).toLocaleString('en-US') : 0}–
              {Math.min(rows.length, (current + 1) * size).toLocaleString('en-US')} of {rows.length.toLocaleString('en-US')}
              {query ? ' · the total row covers all items for the filters' : ''}
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
        </div>
      )}
    </Panel>
  )
}
