import { Component, useCallback, useEffect, useState } from 'react'
import { api } from './api.js'
import App from './App.jsx'
import { Login } from './pages/Login.jsx'

/**
 * Anything that throws while rendering says so, instead of leaving a blank page.
 * Class component because there is no hook for error boundaries.
 */
class Boundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[app] render failed', error, info?.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    const { error } = this.state
    return (
      <div className="signin">
        <div className="card">
          <h2 className="card__title">Something on this page failed to render</h2>
          <p className="muted">Reloading usually clears it; if it does not, the message below is what to report.</p>
          <pre className="error-detail">{String(error?.message || error)}</pre>
          <button type="button" className="btn" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    )
  }
}

/** The welcome screen stays up at least this long, so it reads as a screen rather than a flicker. */
const MIN_SPLASH_MS = 700
const started = Date.now()

/**
 * Takes down the welcome screen in index.html. It sits outside the React root,
 * so React never removes it on its own; it fades, then goes, so no full-screen
 * element is left to intercept clicks.
 */
function hideSplash() {
  const boot = document.getElementById('boot')
  if (!boot) return
  const wait = Math.max(0, MIN_SPLASH_MS - (Date.now() - started))
  setTimeout(() => {
    boot.classList.add('boot--done')
    setTimeout(() => boot.remove(), 400)
  }, wait)
}

/**
 * Decides between the login screen and the dashboard.
 *
 * The session lives in an HttpOnly cookie the client cannot read, so it asks
 * the server who it is on boot — behind the welcome screen. "Not signed in" and
 * "could not ask" are different answers: only the first shows the login screen.
 */
export function Shell() {
  const [session, setSession] = useState(null)
  const [checking, setChecking] = useState(true)
  const [unreachable, setUnreachable] = useState(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    setChecking(true)
    setUnreachable(null)
    api
      .me()
      .then((s) => {
        if (!live) return
        setSession(s)
        // Back from a successful sign-in: the Login page never mounted to tidy up.
        if (window.location.search.includes('signin=')) window.history.replaceState({}, '', window.location.pathname)
      })
      .catch((err) => {
        if (!live) return
        setSession(null)
        if (err?.retryable) setUnreachable(err.message)
      })
      .finally(() => {
        if (!live) return
        setChecking(false)
        hideSplash()
      })
    return () => {
      live = false
    }
  }, [attempt])

  const signOut = useCallback(async () => {
    await api.logout().catch(() => {})
    setSession(null)
  }, [])

  // A request rejected with 401 means the session went away underneath us.
  useEffect(() => {
    const onUnauthorized = () => setSession(null)
    window.addEventListener('ci:unauthorized', onUnauthorized)
    return () => window.removeEventListener('ci:unauthorized', onUnauthorized)
  }, [])

  // The welcome screen covers this; nothing needs to render underneath it yet.
  if (checking) return null

  if (unreachable) {
    return (
      <div className="signin">
        <div className="card card--quiet">
          <p>{unreachable}</p>
          <button type="button" className="btn" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </div>
      </div>
    )
  }

  if (!session) return <Login onSignedIn={setSession} />

  return (
    <Boundary>
      <App session={session} onSignedOut={signOut} />
    </Boundary>
  )
}
