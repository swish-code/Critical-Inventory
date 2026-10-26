import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { IconChevron } from './Icons.jsx'

/**
 * A trigger with a floating panel.
 *
 * The panel is rendered into <body> through a portal. Inside the page it would
 * be clipped by the rounded app frame (overflow: clip) and positioned against
 * the top bar (its backdrop-filter makes it the containing block for fixed
 * elements) — which is how the user menu ended up cut off at the right edge.
 *
 * It is position: fixed and measured before it is shown, so it can flip above
 * the trigger when there is more room there and is clamped to the visible
 * area. It follows scroll and resize, and closes on an outside press or Escape
 * (which hands focus back to the trigger).
 *
 * `trigger({ open, toggle })` renders the button; `render({ close })` renders
 * the panel's contents.
 */
export function Popover({ trigger, render, align = 'start', panelClassName = '', onOpen }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const anchor = useRef(null)
  const panel = useRef(null)

  const close = useCallback(() => setOpen(false), [])
  const toggle = useCallback(() => setOpen((o) => !o), [])

  useEffect(() => {
    if (open) onOpen?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on the open edge
  }, [open])

  const place = useCallback(() => {
    const a = anchor.current?.getBoundingClientRect()
    const p = panel.current
    if (!a || !p) return
    const gap = 8
    const margin = 12
    // clientWidth/Height leave out the scrollbar; innerWidth does not.
    const vw = document.documentElement.clientWidth
    const vh = document.documentElement.clientHeight
    const w = Math.min(p.offsetWidth, vw - margin * 2)
    const h = p.offsetHeight
    const below = vh - a.bottom - margin
    const above = a.top - margin
    const top = below >= h || below >= above ? a.bottom + gap : Math.max(margin, a.top - gap - h)
    let left = align === 'end' ? a.right - w : a.left
    left = Math.min(Math.max(margin, left), vw - w - margin)
    setPos({ top, left, maxWidth: vw - margin * 2, maxHeight: Math.max(160, (below >= h || below >= above ? below : above) - gap) })
  }, [align])

  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return undefined
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, place])

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => {
      if (panel.current?.contains(e.target) || anchor.current?.contains(e.target)) return
      setOpen(false)
    }
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      anchor.current?.querySelector('button')?.focus()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <span className="pop" ref={anchor}>
      {trigger({ open, toggle })}
      {open &&
        createPortal(
          <div
            ref={panel}
            className={`pop__panel ${panelClassName}`}
            role="dialog"
            style={
              pos
                ? { top: pos.top, left: pos.left, maxWidth: pos.maxWidth, maxHeight: pos.maxHeight }
                : { visibility: 'hidden', top: 0, left: 0 }
            }
          >
            {render({ close })}
          </div>,
          document.body
        )}
    </span>
  )
}

/** The pill button the design uses for every filter: icon, value, chevron. */
export function PillTrigger({ icon, label, value, hint, open, toggle, active = false, title }) {
  return (
    <button
      type="button"
      className={`pill${active ? ' pill--set' : ''}${open ? ' pill--open' : ''}`}
      aria-expanded={open}
      aria-haspopup="dialog"
      onClick={toggle}
      title={title}
    >
      {icon}
      <span className="pill__text">
        {label && <span className="pill__label">{label}</span>}
        <span className="pill__value">{value}</span>
        {hint && <span className="pill__hint">{hint}</span>}
      </span>
      <IconChevron size={15} className="pill__chev" />
    </button>
  )
}
