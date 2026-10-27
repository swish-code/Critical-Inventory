import { periodLabel } from '../format.js'
import { IconCalendar } from './Icons.jsx'
import { PillTrigger, Popover } from './Popover.jsx'

const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const clamp = (iso, min, max) => (min && iso < min ? min : max && iso > max ? max : iso)

/**
 * Presets are anchored on the LATEST date in the model, not today: counts are
 * loaded in batches, so "last 7 days" from today could be a week of nothing.
 */
function presets(min, max) {
  if (!max) return []
  const back = (n) => ({ dateFrom: clamp(addDays(max, -(n - 1)), min, max), dateTo: max })
  return [
    { id: 'all', label: 'All dates', range: { dateFrom: null, dateTo: null } },
    { id: 'latest', label: 'Latest count day', range: { dateFrom: max, dateTo: max } },
    { id: '7', label: 'Last 7 days', range: back(7) },
    { id: '14', label: 'Last 14 days', range: back(14) },
    { id: '30', label: 'Last 30 days', range: back(30) },
    { id: 'month', label: 'Latest month', range: { dateFrom: clamp(`${max.slice(0, 7)}-01`, min, max), dateTo: max } },
  ]
}

/**
 * The report's "between" date slicer: presets plus From / To.
 * Both empty means every date, which is what the report's saved slicer covers.
 */
export function DateRange({ value, onChange, min, max }) {
  const { dateFrom = null, dateTo = null } = value ?? {}
  const list = presets(min, max)
  const current = list.find((p) => p.range.dateFrom === dateFrom && p.range.dateTo === dateTo)

  const set = (patch) => {
    const next = { dateFrom, dateTo, ...patch }
    if (next.dateFrom && next.dateTo && next.dateFrom > next.dateTo) {
      ;[next.dateFrom, next.dateTo] = [next.dateTo, next.dateFrom]
    }
    onChange(next)
  }

  return (
    <Popover
      align="end"
      trigger={({ open, toggle }) => (
        <PillTrigger
          icon={<IconCalendar size={16} />}
          value={current ? current.label : periodLabel(dateFrom, dateTo)}
          hint={current ? (current.id === 'all' ? (min && max ? periodLabel(min, max) : null) : periodLabel(dateFrom, dateTo)) : null}
          open={open}
          toggle={toggle}
          active={Boolean(dateFrom || dateTo)}
        />
      )}
      render={({ close }) => (
        <div className="dr">
          <ul className="dr__presets">
            {list.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className={`dr__preset${current?.id === p.id ? ' dr__preset--on' : ''}`}
                  onClick={() => {
                    onChange(p.range)
                    close()
                  }}
                >
                  {p.label}
                </button>
              </li>
            ))}
          </ul>
          <div className="dr__custom">
            <label className="field">
              <span>From</span>
              <input
                type="date"
                min={min ?? undefined}
                max={max ?? undefined}
                value={dateFrom ?? ''}
                onChange={(e) => set({ dateFrom: e.target.value || null })}
              />
            </label>
            <label className="field">
              <span>To</span>
              <input
                type="date"
                min={min ?? undefined}
                max={max ?? undefined}
                value={dateTo ?? ''}
                onChange={(e) => set({ dateTo: e.target.value || null })}
              />
            </label>
            {min && max && (
              <p className="dr__note">
                Data covers {periodLabel(min, max)}
              </p>
            )}
          </div>
        </div>
      )}
    />
  )
}
