import { lazy, Suspense, useEffect, useState } from 'react'
import { api } from '../api.js'
import { IconActivity, IconEdit, IconPlus, IconTrash, IconUsers } from '../components/Icons.jsx'
// Loaded on demand: the charting library is the largest part of the bundle,
// and only administrators ever open this tab.
const AdminUsage = lazy(() => import('./AdminUsage.jsx').then((m) => ({ default: m.AdminUsage })))
import { LocationAccess } from '../components/LocationAccess.jsx'
import { Tooltip } from '../components/Tooltip.jsx'
import { Empty, ErrorBanner, Panel, Tag } from '../components/ui.jsx'
import { fmtDate, relativeTime } from '../format.js'
import { groupLocations } from '../locationGroups.js'
import { useData } from '../useData.js'

const BLANK_USER = { email: '', name: '', role: 'viewer', pages: ['daily', 'summary', 'comparison'], locations: null, active: true }

const lastSeen = (iso) => (iso ? `${relativeTime(Date.parse(iso))} · ${fmtDate(iso.slice(0, 10))}` : 'Never')

/**
 * A short reading of someone's locations: a whole brand by name ("BBT (all
 * 13)"), single locations as they are, and the rest as "+N more".
 */
function describeAccess(chosen, all) {
  if (!chosen.length) return 'No locations'
  const pick = new Set(chosen)
  const parts = []
  const covered = new Set()
  for (const g of groupLocations(all)) {
    if (g.locations.length > 1 && g.locations.every((l) => pick.has(l))) {
      parts.push(`${g.name} (all ${g.locations.length})`)
      g.locations.forEach((l) => covered.add(l))
    }
  }
  parts.push(...chosen.filter((l) => !covered.has(l)))
  return parts.length <= 2 ? parts.join(', ') : `${parts.slice(0, 2).join(', ')} +${parts.length - 2} more`
}

/**
 * The add / edit form, in a dialog. Administrators always see every page and
 * every location, so those choices only show for a viewer.
 */
function UserEditor({ initial, pages, locations, isNew, isSelf, onClose, onSaved }) {
  const [u, setU] = useState(initial)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (patch) => setU((x) => ({ ...x, ...patch }))

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const body = { name: u.name, role: u.role, pages: u.pages, locations: u.locations, active: u.active }
      if (isNew) await api.createUser({ email: u.email, ...body })
      else await api.updateUser(u.email, body)
      onSaved()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  const togglePage = (id) => set({ pages: u.pages.includes(id) ? u.pages.filter((p) => p !== id) : [...u.pages, id] })

  return (
    <div className="modal" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal__card" role="dialog" aria-modal="true" aria-labelledby="user-editor-title" onSubmit={save}>
        <h2 id="user-editor-title" className="modal__title">
          {isNew ? 'Add user' : 'Edit access'}
        </h2>
        {error && (
          <div className="alert" role="alert">
            {error}
          </div>
        )}

        <label className="field">
          <span>Email</span>
          <input
            type="email"
            required
            autoFocus={isNew}
            disabled={!isNew}
            value={u.email}
            onChange={(e) => set({ email: e.target.value })}
            placeholder="name@company.com"
          />
        </label>
        <label className="field">
          <span>Name</span>
          <input value={u.name} onChange={(e) => set({ name: e.target.value })} placeholder="Optional — Microsoft sign-in fills it in" />
        </label>

        <fieldset className="choice">
          <legend>Role</legend>
          {[
            ['viewer', 'Viewer', 'Sees the pages and locations chosen below'],
            ['admin', 'Administrator', 'Sees everything and manages users'],
          ].map(([id, label, hint]) => (
            <label key={id} className={`choice__opt${u.role === id ? ' choice__opt--on' : ''}`}>
              <input
                type="radio"
                name="role"
                value={id}
                checked={u.role === id}
                disabled={isSelf}
                onChange={() => set({ role: id })}
              />
              <span>
                <strong>{label}</strong>
                <span>{hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {u.role === 'viewer' && (
          <>
            <fieldset className="choice">
              <legend>Pages</legend>
              {pages.map((p) => (
                <label key={p.id} className="check">
                  <input type="checkbox" checked={u.pages.includes(p.id)} onChange={() => togglePage(p.id)} />
                  {p.label}
                </label>
              ))}
            </fieldset>

            <fieldset className="choice">
              <legend>Locations</legend>
              <LocationAccess
                value={u.locations}
                onChange={(v) => set({ locations: v })}
                locations={locations}
                loading={!locations.length}
              />
            </fieldset>
          </>
        )}

        <label className="check">
          <input type="checkbox" checked={u.active} disabled={isSelf} onChange={(e) => set({ active: e.target.checked })} />
          Active — can sign in
        </label>

        <div className="modal__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn" disabled={busy}>
            {busy ? 'Saving…' : isNew ? 'Add user' : 'Save changes'}
          </button>
        </div>
      </form>
    </div>
  )
}

/**
 * Admin — who may sign in and what each person sees.
 *
 * Changes apply on that person's next request; nobody needs to sign out. People
 * from ADMIN_EMAILS / ALLOWED_EMAILS in .env are listed read-only; a person from
 * ALLOWED_EMAILS can be given narrower access by adding them here.
 */
function UsersAccess({ me }) {
  const [nonce, setNonce] = useState(0)
  const users = useData(api.adminUsers, {}, { nonce, debounce: 0 })
  const locs = useData(api.adminLocations, {}, { debounce: 0 })
  const [editing, setEditing] = useState(null) // { user, isNew }
  const [error, setError] = useState(null)

  const pages = users.data?.pages ?? []
  const pageLabel = Object.fromEntries(pages.map((p) => [p.id, p.label]))
  const reload = () => setNonce((n) => n + 1)

  const remove = async (u) => {
    if (!window.confirm(`Remove ${u.email}? They will lose access straight away.`)) return
    setError(null)
    try {
      await api.deleteUser(u.email)
      reload()
    } catch (err) {
      setError(err)
    }
  }

  const list = users.data?.users ?? []

  return (
    <>
      <Panel
        title="Users & access"
        tag={users.data ? `${list.length} ${list.length === 1 ? 'person' : 'people'}` : null}
        tools={
          <button type="button" className="btn btn--sm" onClick={() => setEditing({ user: BLANK_USER, isNew: true })}>
            <IconPlus size={15} />
            Add user
          </button>
        }
      >
        <ErrorBanner error={users.error || error} onRetry={reload} />
        {users.loading && !users.data && <div className="skel skel--table" aria-busy="true" />}
        {users.data && !list.length && <Empty title="No users yet" hint="Add the people who should see the dashboard." />}
        {list.length > 0 && (
          <div className="dt">
          <div className="dt__scroll">
            <table className="users">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Pages</th>
                  <th>Locations</th>
                  <th>Status</th>
                  <th>Last sign-in</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {list.map((u) => {
                  const env = u.source === 'env'
                  const admin = u.role === 'admin'
                  return (
                    <tr key={u.email}>
                      <td>
                        <span className="users__who">
                          <span className="user__avatar" aria-hidden="true">
                            {(u.name || u.email).charAt(0).toUpperCase()}
                          </span>
                          <span>
                            <strong>{u.name || u.email.split('@')[0]}</strong>
                            <span className="users__email">{u.email}</span>
                          </span>
                        </span>
                      </td>
                      <td>
                        <Tag tone={admin ? 'dark' : 'grey'}>{admin ? 'Administrator' : 'Viewer'}</Tag>
                        {env && (
                          <span className="users__src" title="Set in .env on the server">
                            .env
                          </span>
                        )}
                      </td>
                      <td>
                        {admin ? (
                          <span className="muted">All pages</span>
                        ) : (
                          <span className="users__pages">
                            {u.pages.map((p) => (
                              <Tag key={p} tone="green">
                                {pageLabel[p]?.replace(' - Critical Inventory', '') ?? p}
                              </Tag>
                            ))}
                          </span>
                        )}
                      </td>
                      <td>
                        {admin || !Array.isArray(u.locations) ? (
                          <span className="muted">All locations</span>
                        ) : (
                          <Tooltip text={u.locations.join(' · ')}>
                            <span className="users__locs" tabIndex={0}>
                              {describeAccess(u.locations, locs.data?.locations ?? [])}
                            </span>
                          </Tooltip>
                        )}
                      </td>
                      <td>
                        <span className={`status status--${u.active ? 'on' : 'off'}`}>{u.active ? 'Active' : 'Disabled'}</span>
                      </td>
                      <td className="muted">{lastSeen(u.lastLoginAt)}</td>
                      <td className="users__actions">
                        {env && admin ? (
                          <span className="muted small">Managed in .env</span>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="iconbtn iconbtn--sm"
                              title={env ? 'Add to the app to set their access' : 'Edit access'}
                              aria-label={`Edit ${u.email}`}
                              onClick={() => setEditing({ user: { ...BLANK_USER, ...u }, isNew: env })}
                            >
                              <IconEdit size={15} />
                            </button>
                            {!env && (
                              <button
                                type="button"
                                className="iconbtn iconbtn--sm"
                                title="Remove"
                                aria-label={`Remove ${u.email}`}
                                disabled={u.email === me}
                                onClick={() => remove(u)}
                              >
                                <IconTrash size={15} />
                              </button>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          </div>
        )}
      </Panel>

      <section className="panel panel--note">
        <p>
          <strong>How access works.</strong> Administrators see every page and location and manage this list. Viewers see
          only the pages and locations ticked for them — enforced by the server on every request, and applied straight away
          without anyone signing out. People in <code>ADMIN_EMAILS</code> in .env are permanent administrators, so access can
          never be locked out.
        </p>
      </section>

      {editing && (
        <UserEditor
          initial={editing.user}
          isNew={editing.isNew}
          isSelf={editing.user.email === me}
          pages={pages}
          locations={locs.data?.locations ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            reload()
          }}
        />
      )}
    </>
  )
}

const TABS = [
  { id: 'users', label: 'Users & access', Icon: IconUsers },
  { id: 'usage', label: 'Usage analytics', Icon: IconActivity },
]

/** The Admin page: a tab bar over Users & access and Usage analytics. */
export function Admin({ me }) {
  const [tab, setTab] = useState(() => {
    try {
      return localStorage.getItem('ci-admin-tab') === 'usage' ? 'usage' : 'users'
    } catch {
      return 'users'
    }
  })

  const choose = (id) => {
    setTab(id)
    try {
      localStorage.setItem('ci-admin-tab', id)
    } catch {
      /* remembered for this visit only */
    }
  }

  return (
    <>
      <div className="tabs" role="tablist" aria-label="Admin">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`tabs__tab${tab === id ? ' tabs__tab--on' : ''}`}
            onClick={() => choose(id)}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>
      {tab === 'users' ? (
        <UsersAccess me={me} />
      ) : (
        <Suspense fallback={<div className="skel skel--table" aria-busy="true" />}>
          <AdminUsage />
        </Suspense>
      )}
    </>
  )
}
