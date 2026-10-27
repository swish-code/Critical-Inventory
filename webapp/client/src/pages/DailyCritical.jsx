import { api } from '../api.js'
import { DataTable } from '../components/DataTable.jsx'
import { ErrorBanner, KpiCard, MetricStrip, Panel } from '../components/ui.jsx'
import { exportFileName } from '../csv.js'
import { fmtCount, fmtDate, fmtKd, fmtKdNumber, fmtQty, tone } from '../format.js'
import { useData } from '../useData.js'

/** The report's table, column for column, with its own display names. */
const COLUMNS = [
  { key: 'date', label: 'Inventory Date', format: fmtDate, width: 118, hint: 'The day the item was counted' },
  { key: 'article', label: 'Item Name', strong: true, width: 240 },
  { key: 'unit', label: 'Unit', width: 72, hint: 'The unit the item is counted in' },
  { key: 'opening', label: 'Opening Stock', num: true, format: fmtQty, hint: 'Stock at the previous count — or at the start of the period if there was none' },
  { key: 'purchase', label: 'Purchase', num: true, format: fmtQty, hint: 'Quantity purchased since the previous count' },
  { key: 'transferIn', label: 'Transfer In', num: true, format: fmtQty, hint: 'Quantity transferred in from other locations' },
  { key: 'transferOut', label: 'Transfer Out', num: true, format: fmtQty, hint: 'Quantity transferred out to other locations (shown negative)' },
  { key: 'wastage', label: 'Wastage', num: true, format: fmtQty, hint: 'Quantity recorded as wastage (shown negative)' },
  { key: 'closing', label: 'Closing', num: true, format: fmtQty, hint: 'The quantity actually counted' },
  { key: 'calcPot', label: 'Calc POT', num: true, format: fmtQty, hint: 'Theoretical stock: opening plus every movement since the previous count' },
  { key: 'variance', label: 'Variance', num: true, format: fmtQty, signed: true, hint: 'Counted minus expected quantity — negative means stock is missing' },
  { key: 'varianceValue', label: 'Variance Value', num: true, format: fmtKdNumber, signed: true, hint: 'Variance × average cost, in KD' },
]

/**
 * Daily Critical Report.
 *
 * Six cards from the model's own measures, and the report's table at its grain
 * (inventory date × item × unit, locations added together). Totals come from
 * the model.
 */
export function DailyCritical({ filters, period, nonce, onLoaded }) {
  const kpis = useData(api.dailyKpis, filters, { nonce, onLoaded })
  const table = useData(api.dailyTable, filters, { nonce, onLoaded })

  const k = kpis.data ?? {}
  const first = kpis.loading && !kpis.data

  return (
    <>
      <ErrorBanner error={kpis.error} onRetry={kpis.reload} />

      <div className="kpis">
        <KpiCard
          loading={first}
          label="Net Variance (KD)"
          tag={period}
          value={fmtKd(k.netVarianceValue)}
          tone={tone(k.netVarianceValue)}
          foot="Surplus value minus shortage value"
          hint="Total variance value in KD — negative means more stock is missing than found"
        />
        <KpiCard
          loading={first}
          label="Shortage Value (KD)"
          tag={period}
          value={fmtKd(k.shortageValue)}
          tone="neg"
          foot="Counted below theoretical stock"
          hint="Value of every row that came in below the expected stock, shown as a positive amount"
        />
        <KpiCard
          loading={first}
          label="Surplus Value (KD)"
          tag={period}
          value={fmtKd(k.surplusValue)}
          tone="pos"
          foot="Counted above theoretical stock"
          hint="Value of every row that came in above the expected stock"
        />
        <KpiCard
          loading={first}
          label="Net Variance"
          tag={period}
          value={fmtQty(k.netVariance)}
          tone={tone(k.netVariance)}
          foot="Variance in quantity, all units"
          hint="Counted minus expected quantity, added up across items — mixes KG, EACH, PORTION and LITER"
        />
      </div>

      <MetricStrip
        loading={first}
        title="Counts"
        items={[
          {
            label: 'Items Checked',
            value: fmtCount(k.itemsChecked),
            foot: 'Rows in the period',
            hint: 'Number of rows — one per item, location and count day',
          },
          {
            label: 'Items with Variance',
            value: fmtCount(k.itemsWithVariance),
            foot: 'More than 0.01 away from theoretical',
            hint: 'Rows where the counted quantity differs from the expected by more than 0.01',
          },
        ]}
      />

      <Panel
        title="Daily critical counts"
        tag={table.data ? `${table.data.rows.length.toLocaleString('en-US')} rows` : null}
        busy={table.loading && Boolean(table.data)}
      >
        <ErrorBanner error={table.error} onRetry={table.reload} />
        {table.loading && !table.data ? (
          <div className="skel skel--table" aria-busy="true" />
        ) : (
          table.data && (
            <DataTable
              columns={COLUMNS}
              rows={table.data.rows}
              totals={table.data.totals}
              searchPlaceholder="Search item, unit or date"
              exportName={exportFileName('Daily Critical Report', period)}
            />
          )
        )}
      </Panel>
    </>
  )
}
