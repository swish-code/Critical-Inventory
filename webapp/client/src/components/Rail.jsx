/**
 * The narrow icon rail on the left. The current page is the black square; the
 * page name shows as a tooltip and to screen readers. Admin-only entries sit
 * apart at the foot of the rail.
 */
export function Rail({ pages, current, onChange }) {
  const item = ({ id, label, Icon }) => {
    const on = id === current
    return (
      <li key={id}>
        <button
          type="button"
          className={`rail__item${on ? ' rail__item--on' : ''}`}
          aria-current={on ? 'page' : undefined}
          onClick={() => onChange(id)}
          title={label}
        >
          <Icon size={20} />
          <span className="sr-only">{label}</span>
        </button>
      </li>
    )
  }

  const main = pages.filter((p) => !p.adminOnly)
  const foot = pages.filter((p) => p.adminOnly)

  return (
    <nav className="rail" aria-label="Pages">
      <ul className="rail__list">{main.map(item)}</ul>
      {foot.length > 0 && <ul className="rail__list rail__list--foot">{foot.map(item)}</ul>}
    </nav>
  )
}
