import { tone as toneOf } from '../format.js'
import { IconChevron } from './Icons.jsx'

/**
 * A signed figure as a tinted pill — green with an up chevron when positive,
 * red with a down chevron when negative — as in the design's tables. Zero and
 * blank stay plain, so a column of mostly zeros does not turn into a wall of
 * grey pills.
 */
export function Change({ value, text }) {
  const t = toneOf(value)
  if (t === 'neutral') return <span className="chg chg--none">{text}</span>
  return (
    <span className={`chg chg--${t}`}>
      <IconChevron size={12} className="chg__icon" />
      {text}
    </span>
  )
}
