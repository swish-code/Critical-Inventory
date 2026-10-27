import { api } from '../api.js'
import { DataTable } from '../components/DataTable.jsx'
import { ErrorBanner, Panel } from '../components/ui.jsx'
import { exportFileName } from '../csv.js'
import { fmtDate, fmtKdNumber, fmtPct } from '../format.js'
import { useData } from '../useData.js'

/** The report's table columns, in its order, each a model measure. */
const COLUMNS = [
  { key: 'date', label: 'Date', format: fmtDate, width: 118, hint: 'Only days on which counts happened are listed' },
  { key: 'salesKd', label: 'Sales KD', num: true, format: fmtKdNumber, hint: 'Net sales for the day across the whole business — not narrowed by location' },
  { key: 'actualVarianceKd', label: 'Actual Variance KD', num: true, format: fmtKdNumber, signed: true, hint: 'Variance value of the day’s rows' },
  { key: 'actualVariancePct', label: 'Actual Variance %', num: true, format: fmtPct, signed: true, hint: 'Actual variance KD ÷ Sales KD' },
  { key: 'targetVarianceKd', label: 'Target Variance KD', num: true, format: fmtKdNumber, hint: 'Sales KD × the target %' },
  { key: 'targetVariancePct', label: 'Target Variance % Value', num: true, format: fmtPct, hint: 'The target set in the Target control — 0.5% when none is set' },
  { key: 'variancePct', label: 'Variance %', num: true, format: fmtPct, signed: true, hint: 'Target % minus actual variance %' },
  { key: 'varianceKd', label: 'Variance KD', num: true, format: fmtKdNumber, signed: true, hint: 'Target variance KD minus actual variance KD' },
]

/**
 * Comparison Report.
 *
 * One row per day on which counts happened, the target set by the TARGET
 * VARIANCE % control in the top bar, and the model's totals row. Sales KD is
 * the whole business's sales for the day: the model has no link between sales
 * and inventory locations, exactly as in the Power BI report.
 */
export function Comparison({ filters, target, period, nonce, onLoaded }) {
  const data = useData(api.comparison, { ...filters, target }, { nonce, onLoaded })

  return (
    <Panel
      title="Actual vs target variance"
      tag={data.data ? `${data.data.rows.length} count days` : null}
      busy={data.loading && Boolean(data.data)}
    >
      <ErrorBanner error={data.error} onRetry={data.reload} />
      {data.loading && !data.data ? (
        <div className="skel skel--table" aria-busy="true" />
      ) : (
        data.data && (
          <DataTable
            columns={COLUMNS}
            rows={data.data.rows}
            totals={data.data.totals}
            initialSort={{ key: 'date', dir: 'asc' }}
            searchPlaceholder="Search date"
            exportName={exportFileName('Comparison Report', period)}
          />
        )
      )}
    </Panel>
  )
}
