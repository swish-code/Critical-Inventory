import { IconChevron, IconMoon, IconRefresh, IconSignOut, IconSun } from './Icons.jsx'
import { Popover } from './Popover.jsx'

/** Initial for the avatar: from the name when there is one, otherwise the email. */
const initial = (user) => (user.name || user.email || '?').trim().charAt(0).toUpperCase()

function UserMenu({ user, onSignOut }) {
  return (
    <Popover
      align="end"
      trigger={({ open, toggle }) => (
        <button type="button" className="user" aria-expanded={open} aria-haspopup="dialog" onClick={toggle}>
          <span className="user__avatar" aria-hidden="true">
            {initial(user)}
          </span>
          <span className="user__name">{user.name || user.email.split('@')[0]}</span>
          <IconChevron size={15} className="pill__chev" />
        </button>
      )}
      render={() => (
        <div className="menu">
          <p className="menu__who">
            <strong>{user.name || 'Signed in'}</strong>
            <span>{user.email}</span>
          </p>
          <button type="button" className="menu__item" onClick={onSignOut}>
            <IconSignOut size={16} />
            Sign out
          </button>
        </div>
      )}
    />
  )
}

/**
 * Brand block on the left, the page's slicers as pills in the middle, and the
 * app controls on the right: refresh, theme and the user menu.
 */
export function TopBar({ filters, onReset, canReset, busy, onRefresh, refreshing, theme, user, onSignOut }) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand__logo">
          <img src="/swish-logo.jpg" alt="SWiSH" />
        </span>
        <span className="brand__text">
          <span className="brand__name">Critical Inventory Dashboard</span>
          <span className="brand__sub">Business Performance &amp; Analytics</span>
        </span>
      </div>

      <div className="topbar__filters">
        {filters}
        {canReset && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={onReset}>
            Reset
          </button>
        )}
        {busy && <span className="busy-dot" aria-label="Updating" title="Updating" />}
      </div>

      <div className="topbar__actions">
        <button
          type="button"
          className={`iconbtn${refreshing ? ' iconbtn--spin' : ''}`}
          onClick={onRefresh}
          disabled={refreshing}
          title="Refresh data from Power BI"
          aria-label="Refresh data from Power BI"
        >
          <IconRefresh size={17} />
        </button>
        <button
          type="button"
          className="iconbtn"
          onClick={theme.toggle}
          title={theme.dark ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-label={theme.dark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme.dark ? <IconSun size={17} /> : <IconMoon size={17} />}
        </button>
        <UserMenu user={user} onSignOut={onSignOut} />
      </div>
    </header>
  )
}
