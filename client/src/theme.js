import { useCallback, useEffect, useState } from 'react'

/**
 * Light / dark toggle.
 *
 * With no choice saved the page follows the system setting (tokens.css does
 * that through prefers-color-scheme). A choice is kept in this browser only and
 * applied as data-theme on <html>, which tokens.css honours over the system.
 */

const KEY = 'ci-theme'

function read() {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : null
  } catch {
    return null
  }
}

const systemDark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false

export function useTheme() {
  const [choice, setChoice] = useState(read)
  const [system, setSystem] = useState(systemDark)

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!mq) return undefined
    const on = () => setSystem(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  useEffect(() => {
    const root = document.documentElement
    if (choice) root.setAttribute('data-theme', choice)
    else root.removeAttribute('data-theme')
  }, [choice])

  const dark = choice ? choice === 'dark' : system

  const toggle = useCallback(() => {
    const next = dark ? 'light' : 'dark'
    setChoice(next)
    try {
      localStorage.setItem(KEY, next)
    } catch {
      /* the toggle still works for this visit */
    }
  }, [dark])

  return { dark, toggle }
}
