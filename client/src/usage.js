import { useEffect, useRef } from 'react'

/**
 * Usage tracking for the Admin page's Usage analytics.
 *
 * A page view when a page opens, and one "beat" a minute while the tab is
 * visible AND the person has used it (mouse, keys, scroll, touch) in the last
 * 10 minutes — so idle time is never counted as active time. Fire and forget:
 * tracking never shows an error or retries.
 */
const BEAT_MS = 60_000
const IDLE_MS = 10 * 60_000

function send(type, page) {
  try {
    fetch('/api/usage/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, page }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    /* tracking must never break the page */
  }
}

export function useUsageTracking(page) {
  const lastInput = useRef(Date.now())
  const current = useRef(page)
  current.current = page

  useEffect(() => {
    if (page) send('view', page)
  }, [page])

  useEffect(() => {
    let last = 0
    const touch = () => {
      const now = Date.now()
      if (now - last > 5_000) {
        last = now
        lastInput.current = now
      }
    }
    const events = ['mousemove', 'mousedown', 'keydown', 'wheel', 'scroll', 'touchstart']
    for (const e of events) window.addEventListener(e, touch, { passive: true })

    const timer = setInterval(() => {
      const visible = document.visibilityState === 'visible'
      const engaged = Date.now() - lastInput.current < IDLE_MS
      if (visible && engaged && current.current) send('beat', current.current)
    }, BEAT_MS)

    return () => {
      for (const e of events) window.removeEventListener(e, touch)
      clearInterval(timer)
    }
  }, [])
}
