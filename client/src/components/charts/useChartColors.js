import { useEffect, useState } from 'react'

const TOKENS = {
  s1: '--series-1',
  s2: '--series-2',
  s3: '--series-3',
  grid: '--chart-grid',
  axis: '--chart-axis',
  surface: '--surface',
  text: '--text',
  muted: '--text-muted',
}

const read = () => {
  const css = getComputedStyle(document.documentElement)
  return Object.fromEntries(Object.entries(TOKENS).map(([k, v]) => [k, css.getPropertyValue(v).trim()]))
}

/**
 * The chart colours as plain values. Recharts writes them into SVG attributes,
 * where var() does not resolve, so they are read from the tokens and read again
 * whenever the theme changes — the system setting or the in-app toggle.
 */
export function useChartColors() {
  const [colors, setColors] = useState(read)
  useEffect(() => {
    const update = () => setColors(read())
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    mq?.addEventListener('change', update)
    const obs = new MutationObserver(update)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => {
      mq?.removeEventListener('change', update)
      obs.disconnect()
    }
  }, [])
  return colors
}
