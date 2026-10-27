/**
 * CSV export of what a table is showing.
 *
 * A UTF-8 byte-order mark goes first so Excel reads Arabic and other non-ASCII
 * item names correctly. Numbers are written raw (not formatted), so the file
 * can be summed and checked against Power BI's own export.
 */

const escape = (v) => {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * @param {string} filename
 * @param {{ key: string, label: string }[]} columns
 * @param {object[]} rows
 * @param {object|null} totals  one row keyed like `rows`, written last as "Total"
 */
export function downloadCsv(filename, columns, rows, totals = null) {
  const lines = [columns.map((c) => escape(c.label)).join(',')]
  for (const r of rows) lines.push(columns.map((c) => escape(r[c.key])).join(','))
  if (totals) {
    lines.push(columns.map((c, i) => escape(i === 0 ? 'Total' : (totals[c.key] ?? ''))).join(','))
  }

  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** "Daily Critical Report - 01 Oct – 17 Oct 2026.csv", minus characters Windows refuses. */
export const exportFileName = (base, period) => `${base} - ${period}.csv`.replace(/[\\/:*?"<>|]/g, '-')
