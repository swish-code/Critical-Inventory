import { useEffect, useState } from 'react'
import { IconTarget } from './Icons.jsx'
import { PillTrigger, Popover } from './Popover.jsx'

export const DEFAULT_TARGET = 10

/**
 * The report's TARGET VARIANCE % control: a number from 0 to 100, where 10
 * means 10%. Cleared, no target is set and the model uses its own 0.5%.
 */
export function TargetInput({ value, onChange }) {
  const [draft, setDraft] = useState(value ?? '')
  useEffect(() => setDraft(value ?? ''), [value])

  const apply = (close) => {
    const n = draft === '' ? null : Number(draft)
    if (n === null || (Number.isFinite(n) && n >= 0 && n <= 100)) {
      onChange(n === null ? null : Math.round(n * 100) / 100)
      close()
    }
  }

  const invalid = draft !== '' && !(Number(draft) >= 0 && Number(draft) <= 100)

  return (
    <Popover
      align="end"
      trigger={({ open, toggle }) => (
        <PillTrigger
          icon={<IconTarget size={16} />}
          label="Target"
          value={value === null || value === undefined ? '0.5% (model default)' : `${value}%`}
          open={open}
          toggle={toggle}
          active={value !== DEFAULT_TARGET}
        />
      )}
      render={({ close }) => (
        <form
          className="target"
          onSubmit={(e) => {
            e.preventDefault()
            apply(close)
          }}
        >
          <label className="field">
            <span>Target variance %</span>
            <span className="target__input">
              <input
                autoFocus
                type="number"
                inputMode="decimal"
                min="0"
                max="100"
                step="0.01"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                aria-invalid={invalid}
              />
              <span aria-hidden="true">%</span>
            </span>
          </label>
          <p className="target__note">
            {invalid ? 'Enter a number from 0 to 100.' : 'Leave empty to use the model’s default of 0.5%.'}
          </p>
          <div className="target__actions">
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setDraft(DEFAULT_TARGET)}>
              Reset to {DEFAULT_TARGET}%
            </button>
            <button type="submit" className="btn btn--sm" disabled={invalid}>
              Apply
            </button>
          </div>
        </form>
      )}
    />
  )
}
