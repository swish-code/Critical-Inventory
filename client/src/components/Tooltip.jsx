import { cloneElement, useCallback, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * A dark bubble with an arrow, above the element it explains — below it when
 * there is no room above. Shown on hover and on keyboard focus, and announced
 * through aria-describedby. Rendered into <body> so no container can clip it.
 *
 * Wraps exactly one element: <Tooltip text="…"><button>…</button></Tooltip>.
 */
export function Tooltip({ text, children, delay = 120 }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const anchor = useRef(null)
  const bubble = useRef(null)
  const timer = useRef(null)
  const id = useId()

  const show = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(true), delay)
  }, [delay])

  const hide = useCallback(() => {
    clearTimeout(timer.current)
    setOpen(false)
  }, [])

  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const a = anchor.current?.getBoundingClientRect()
    const b = bubble.current
    if (!a || !b) return
    const margin = 10
    const gap = 10
    const vw = document.documentElement.clientWidth
    const w = b.offsetWidth
    const h = b.offsetHeight
    const below = a.top - gap - h < margin
    const top = below ? a.bottom + gap : a.top - gap - h
    const center = a.left + a.width / 2
    const left = Math.min(Math.max(margin, center - w / 2), vw - w - margin)
    // The arrow keeps pointing at the element even when the bubble is pushed sideways.
    setPos({ top, left, below, arrow: Math.min(Math.max(14, center - left), w - 14) })
  }, [open])

  if (!text) return children

  const child = cloneElement(children, {
    ref: anchor,
    onMouseEnter: show,
    onMouseLeave: hide,
    onFocus: show,
    onBlur: hide,
    'aria-describedby': open ? id : undefined,
  })

  return (
    <>
      {child}
      {open &&
        createPortal(
          <div
            ref={bubble}
            id={id}
            role="tooltip"
            className={`tip${pos?.below ? ' tip--below' : ''}`}
            style={pos ? { top: pos.top, left: pos.left, '--tip-arrow': `${pos.arrow}px` } : { visibility: 'hidden', top: 0, left: 0 }}
          >
            {text}
          </div>,
          document.body
        )}
    </>
  )
}
