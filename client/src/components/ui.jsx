import { IconAlert } from './Icons.jsx'
import { Tooltip } from './Tooltip.jsx'

/** The small rounded chip beside a card label ("Yesterday" in the design). */
export function Tag({ children, tone = 'green' }) {
  return <span className={`tag tag--${tone}`}>{children}</span>
}

/**
 * A KPI card: uppercase label with a tag, then the figure.
 * `tone` colours the figure: 'neg' red, 'pos' green, otherwise plain.
 */
export function KpiCard({ label, tag, value, foot, tone = 'neutral', loading = false, hint }) {
  if (loading) return <div className="kpi skel" aria-busy="true" />
  return (
    <Tooltip text={hint}>
      <section className="kpi" tabIndex={hint ? 0 : undefined}>
        <header className="kpi__top">
          <h3 className="kpi__label">{label}</h3>
          {tag && <Tag>{tag}</Tag>}
        </header>
        <p className={`kpi__value kpi__value--${tone}`}>{value}</p>
        {foot && <p className="kpi__foot">{foot}</p>}
      </section>
    </Tooltip>
  )
}

/**
 * One card holding several figures side by side, split by vertical rules —
 * the design's "Operations" strip. items: [{ label, value, foot?, tone?, hint? }]
 */
export function MetricStrip({ title, items, loading = false }) {
  if (loading) return <div className="strip skel" aria-busy="true" />
  return (
    <section className="strip">
      {title && <h3 className="strip__title">{title}</h3>}
      {items.map((it) => (
        <Tooltip key={it.label} text={it.hint}>
          <div className="strip__item" tabIndex={it.hint ? 0 : undefined}>
            <span className="kpi__label">{it.label}</span>
            <span className={`strip__value kpi__value--${it.tone ?? 'neutral'}`}>{it.value}</span>
            {it.foot && <span className="kpi__foot">{it.foot}</span>}
          </div>
        </Tooltip>
      ))}
    </section>
  )
}

/** A white card with a title row and a slot for tools on the right. */
export function Panel({ title, tag, tools, children, busy = false }) {
  return (
    <section className={`panel${busy ? ' panel--busy' : ''}`} aria-busy={busy}>
      <header className="panel__head">
        <div className="panel__title">
          <h2>{title}</h2>
          {tag && <Tag tone="grey">{tag}</Tag>}
        </div>
        {tools && <div className="panel__tools">{tools}</div>}
      </header>
      <div className="panel__body">{children}</div>
    </section>
  )
}

export function ErrorBanner({ error, onRetry }) {
  if (!error) return null
  return (
    <div className="banner banner--error" role="alert">
      <IconAlert size={18} />
      <span>
        <strong>Could not load data.</strong> {error.message || String(error)}
      </span>
      {onRetry && (
        <button type="button" className="btn btn--ghost btn--sm" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  )
}

export function Empty({ title = 'No data for these filters', hint = 'Try widening the date range or clearing a filter.' }) {
  return (
    <div className="empty">
      <p className="empty__title">{title}</p>
      <p className="empty__hint">{hint}</p>
    </div>
  )
}
