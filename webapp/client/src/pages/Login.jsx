import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { BRANDS } from '../brands.js'
import { IconChevron, IconMail } from '../components/Icons.jsx'

/**
 * Sign-in — Microsoft work accounts in this organisation, with a collapsed
 * "Administrator sign-in" for the temporary local account while it exists.
 * Who gets in, and what they see, is decided on the server.
 */

/** Microsoft's own mark, drawn inline so the page pulls in nothing external. */
function MicrosoftMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="0" y="0" width="7.4" height="7.4" fill="#f25022" />
      <rect x="8.6" y="0" width="7.4" height="7.4" fill="#7fba00" />
      <rect x="0" y="8.6" width="7.4" height="7.4" fill="#00a4ef" />
      <rect x="8.6" y="8.6" width="7.4" height="7.4" fill="#ffb900" />
    </svg>
  )
}

/** What the callback told us, read once and then cleared from the address bar. */
function readCallback() {
  const params = new URLSearchParams(window.location.search)
  const signin = params.get('signin')
  if (!signin) return null
  const detail = { signin, reason: params.get('reason'), email: params.get('email') }
  window.history.replaceState({}, '', window.location.pathname)
  return detail
}

function AdminSignIn({ onSignedIn }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      onSignedIn(await api.localLogin(email, password))
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      <label className="field">
        <span>Email</span>
        <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="field">
        <span>Password</span>
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <button type="submit" className="btn btn--block" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}

export function Login({ onSignedIn }) {
  const [error, setError] = useState(null)
  const [methods, setMethods] = useState({ microsoft: true, local: false, contact: null })
  const [showAdmin, setShowAdmin] = useState(false)

  useEffect(() => {
    api
      .methods()
      .then((m) => setMethods({ microsoft: Boolean(m.microsoft), local: Boolean(m.local), contact: m.contact ?? null }))
      .catch(() => {
        // If the server cannot be asked, leave the Microsoft button on: it is
        // the main way in, so offering it and failing beats offering nothing.
      })

    const back = readCallback()
    if (!back) return
    if (back.signin === 'ok') {
      api
        .me()
        .then(onSignedIn)
        .catch(() => setError('Signed in, but the session could not be read. Try again.'))
    } else if (back.signin === 'denied') {
      setError(`${back.email ?? 'That account'} does not have access yet. Use Request access below.`)
    } else {
      setError(back.reason || 'Microsoft sign-in did not complete.')
    }
  }, [onSignedIn])

  const requestHref = methods.contact
    ? `mailto:${methods.contact}?subject=${encodeURIComponent('Critical Inventory Dashboard — access request')}&body=${encodeURIComponent(
        `Please give me access to the Critical Inventory Dashboard.\n\nName:\nPages needed:\nLocations:\n\nThe Admin page: ${window.location.origin}/`
      )}`
    : null

  return (
    <div className="login">
      <header className="login__brand">
        <span className="login__logo">
          <img src="/swish-logo.jpg" alt="SWiSH" />
        </span>
        <span>
          <span className="login__name">
            <span className="login__name-a">Critical Inventory</span> <span className="login__name-b">Dashboard</span>
          </span>
          <span className="login__sub">Business Performance &amp; Analytics</span>
        </span>
      </header>

      <main className="login__card">
        <h1 className="login__title">Sign in</h1>
        <p className="login__lead">Use your company Microsoft account.</p>

        {error && (
          <div className="alert" role="alert">
            {error}
          </div>
        )}

        {methods.microsoft ? (
          <a className="btn btn--ms" href="/api/auth/microsoft/start">
            <MicrosoftMark />
            Sign in with Microsoft
          </a>
        ) : (
          !methods.local && (
            <p className="alert">Microsoft sign-in is not configured on this server yet.</p>
          )
        )}

        {methods.local && (
          <>
            <button
              type="button"
              className={`login__toggle${showAdmin ? ' login__toggle--open' : ''}`}
              aria-expanded={showAdmin}
              onClick={() => setShowAdmin((s) => !s)}
            >
              <IconChevron size={15} />
              Administrator sign-in
            </button>
            {showAdmin && <AdminSignIn onSignedIn={onSignedIn} />}
          </>
        )}

        <p className="login__assure">Secure session · your access is scoped to your role.</p>

        <hr className="login__rule" />

        <div className="login__request">
          <p>Don&apos;t have access yet?</p>
          {requestHref ? (
            <a className="btn btn--soft" href={requestHref}>
              <IconMail size={17} />
              Request access
            </a>
          ) : (
            <p className="muted small">Ask an administrator to add you on the Admin page.</p>
          )}
        </div>
      </main>

      <footer className="login__brands">
        <p className="login__brandsLabel">OUR BRANDS</p>
        <ul>
          {BRANDS.map((b) => (
            <li key={b.label} title={b.label}>
              <span className="login__chip">
                <img
                  src={b.logo}
                  alt={b.label}
                  style={{ transform: `scale(${b.zoom})`, objectFit: b.fit ?? 'contain' }}
                />
              </span>
            </li>
          ))}
        </ul>
      </footer>
    </div>
  )
}
