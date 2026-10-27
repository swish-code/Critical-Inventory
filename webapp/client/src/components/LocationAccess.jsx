import { useMemo, useState } from 'react'
import { groupLocations } from '../locationGroups.js'
import { IconChevron, IconClose, IconSearch } from './Icons.jsx'

/** Chips shown before "+N more"; the full list is always one click away below. */
const CHIP_MAX = 14

/**
 * Location access for one user: every location, or a chosen set.
 *
 * The set can be built a location at a time or a whole brand at once (the
 * group's own checkbox), searched, and pared back from the chips at the top.
 * `value` is null for every location, or an array of location names.
 */
export function LocationAccess({ value, onChange, locations, loading }) {
  const restricted = Array.isArray(value)
  const chosen = useMemo(() => new Set(value ?? []), [value])
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(() => new Set())

  const groups = useMemo(() => groupLocations(locations), [locations])

  const q = query.trim().toLowerCase()
  const visible = useMemo(
    () =>
      groups
        .map((g) => ({ ...g, shown: q ? g.locations.filter((l) => l.toLowerCase().includes(q)) : g.locations }))
        .filter((g) => g.shown.length),
    [groups, q]
  )

  const set = (next) => onChange([...next].sort((a, b) => a.localeCompare(b)))
  const toggle = (l) => {
    const next = new Set(chosen)
    next.has(l) ? next.delete(l) : next.add(l)
    set(next)
  }
  const toggleGroup = (list) => {
    const all = list.every((l) => chosen.has(l))
    const next = new Set(chosen)
    for (const l of list) all ? next.delete(l) : next.add(l)
    set(next)
  }
  const flip = (name) =>
    setOpen((o) => {
      const n = new Set(o)
      n.has(name) ? n.delete(name) : n.add(name)
      return n
    })

  // Locations someone was given that are no longer in the model still count —
  // they are listed so they can be seen and removed.
  const missing = (value ?? []).filter((l) => !locations.includes(l))

  return (
    <div className="la">
      <div className="seg" role="radiogroup" aria-label="Location access">
        <button
          type="button"
          role="radio"
          aria-checked={!restricted}
          className={`seg__opt${!restricted ? ' seg__opt--on' : ''}`}
          onClick={() => onChange(null)}
        >
          All locations
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={restricted}
          className={`seg__opt${restricted ? ' seg__opt--on' : ''}`}
          onClick={() => onChange(value ?? [])}
        >
          Selected locations
        </button>
      </div>

      {!restricted && <p className="la__note">This person sees every location, including any added to the model later.</p>}

      {restricted && (
        <>
          <div className="la__summary">
            <strong>
              {chosen.size} of {locations.length || '…'} locations
            </strong>
            {chosen.size > 0 && (
              <button type="button" className="link" onClick={() => onChange([])}>
                Clear
              </button>
            )}
          </div>

          {chosen.size > 0 ? (
            <ul className="la__chips" aria-label="Chosen locations">
              {[...chosen].slice(0, CHIP_MAX).map((l) => (
                <li key={l}>
                  <span className={`chip${missing.includes(l) ? ' chip--warn' : ''}`} title={missing.includes(l) ? 'Not in the model any more' : l}>
                    {l}
                    <button type="button" aria-label={`Remove ${l}`} onClick={() => toggle(l)}>
                      <IconClose size={12} />
                    </button>
                  </span>
                </li>
              ))}
              {chosen.size > CHIP_MAX && <li className="la__more">+{chosen.size - CHIP_MAX} more</li>}
            </ul>
          ) : (
            <p className="la__note la__note--warn">Choose at least one location — a whole brand, or single locations below.</p>
          )}

          <label className="search la__search">
            <IconSearch size={15} />
            <input
              type="search"
              placeholder="Search locations"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search locations"
            />
          </label>

          <div className="la__groups">
            {loading && !locations.length && <p className="la__note">Loading locations…</p>}
            {!loading && !visible.length && <p className="la__note">No locations match “{query}”.</p>}
            {visible.map((g) => {
              const count = g.locations.filter((l) => chosen.has(l)).length
              const all = count === g.locations.length
              const some = count > 0 && !all
              const expanded = Boolean(q) || open.has(g.name)
              return (
                <section key={g.name} className="la__group">
                  <div className="la__head">
                    <label className="check la__brand">
                      <input
                        type="checkbox"
                        checked={all}
                        ref={(el) => el && (el.indeterminate = some)}
                        onChange={() => toggleGroup(g.locations)}
                        aria-label={`All ${g.name} locations`}
                      />
                      <strong>{g.name}</strong>
                    </label>
                    <span className="la__count">
                      {count ? `${count} / ${g.locations.length}` : g.locations.length}
                    </span>
                    <button
                      type="button"
                      className={`la__toggle${expanded ? ' la__toggle--open' : ''}`}
                      aria-expanded={expanded}
                      aria-label={`${expanded ? 'Hide' : 'Show'} ${g.name} locations`}
                      onClick={() => flip(g.name)}
                      disabled={Boolean(q)}
                    >
                      <IconChevron size={15} />
                    </button>
                  </div>
                  {expanded && (
                    <ul className="la__list">
                      {g.shown.map((l) => (
                        <li key={l}>
                          <label className="check">
                            <input type="checkbox" checked={chosen.has(l)} onChange={() => toggle(l)} />
                            {l}
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
