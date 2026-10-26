import { useMemo, useState } from 'react'
import { IconCheck, IconSearch } from './Icons.jsx'
import { PillTrigger, Popover } from './Popover.jsx'

/** Rows drawn at once. Search narrows the rest; nobody scrolls 600 checkboxes. */
const SHOW_MAX = 400

/**
 * A slicer: multi-select with search, Select all and Clear.
 *
 * An empty selection means "no filter", as in Power BI. Selected values that
 * the other slicers have since narrowed out of `options` are kept and shown at
 * the top, so a selection never silently disappears.
 */
export function MultiSelect({ icon, noun, plural, options = [], value = [], onChange, loading = false }) {
  const [query, setQuery] = useState('')

  const selected = useMemo(() => new Set(value), [value])

  const shown = useMemo(() => {
    const missing = value.filter((v) => !options.includes(v))
    const all = [...missing, ...options]
    const q = query.trim().toLowerCase()
    return q ? all.filter((o) => o.toLowerCase().includes(q)) : all
  }, [options, value, query])

  const label =
    value.length === 0 ? `All ${plural}` : value.length === 1 ? value[0] : `${value.length} ${plural}`

  const toggleOne = (o) => onChange(selected.has(o) ? value.filter((v) => v !== o) : [...value, o])
  const selectShown = () => onChange([...new Set([...value, ...shown])])

  return (
    <Popover
      panelClassName="pop__panel--list"
      trigger={({ open, toggle }) => (
        <PillTrigger
          icon={icon}
          value={label}
          open={open}
          toggle={toggle}
          active={value.length > 0}
          title={value.length > 1 ? value.join(', ') : undefined}
        />
      )}
      render={() => (
        <div className="ms">
          <div className="ms__search">
            <IconSearch size={15} />
            <input
              autoFocus
              type="search"
              placeholder={`Search ${plural}`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={`Search ${plural}`}
            />
          </div>
          <div className="ms__head">
            <button type="button" className="link" onClick={selectShown} disabled={!shown.length}>
              Select {query ? 'matches' : 'all'}
            </button>
            <button type="button" className="link" onClick={() => onChange([])} disabled={!value.length}>
              Clear
            </button>
          </div>
          <ul className="ms__list" role="listbox" aria-multiselectable="true" aria-label={plural}>
            {loading && !options.length && <li className="ms__note">Loading…</li>}
            {!loading && !shown.length && <li className="ms__note">{query ? 'No matches' : 'No values available'}</li>}
            {shown.slice(0, SHOW_MAX).map((o) => {
              const on = selected.has(o)
              return (
                <li key={o}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={on}
                    className={`opt${on ? ' opt--on' : ''}`}
                    onClick={() => toggleOne(o)}
                  >
                    <span className="opt__box">{on && <IconCheck size={12} />}</span>
                    <span className="opt__text">{o}</span>
                  </button>
                </li>
              )
            })}
            {shown.length > SHOW_MAX && (
              <li className="ms__note">{shown.length - SHOW_MAX} more — type to narrow the list</li>
            )}
          </ul>
          <div className="ms__foot">
            {options.length} {options.length === 1 ? noun : plural} · {value.length} selected
          </div>
        </div>
      )}
    />
  )
}
