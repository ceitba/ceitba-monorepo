import type { ReactNode } from 'react'

interface CheckboxProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: ReactNode
  // Visible explanation under the label (never a hover-only tooltip).
  hint?: ReactNode
  disabled?: boolean
  // Only when the visible label needs more context for screen readers;
  // it must start with the visible label text.
  'aria-label'?: string
}

// Native checkbox styled as the editorial box, with its label (and hint)
// as the 44px click target.
export default function Checkbox({ checked, onChange, label, hint, disabled = false, 'aria-label': ariaLabel }: CheckboxProps) {
  return (
    <label
      className={`inline-flex items-start gap-3 min-h-[44px] py-2.5 select-none ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        aria-hidden="true"
        className={`mt-0.5 flex items-center justify-center w-5 h-5 rounded-sm border flex-shrink-0 transition-colors duration-150 peer-focus-visible:ring-2 peer-focus-visible:ring-primary/40 ${
          checked
            ? 'bg-primary border-primary text-white dark:bg-primary-400 dark:border-primary-400'
            : 'bg-white dark:bg-night-surface border-border dark:border-night-border'
        }`}
      >
        {checked && (
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="2 6 5 9 10 3" />
          </svg>
        )}
      </span>
      <span className="flex flex-col">
        <span className="font-body text-body-sm text-ink-primary dark:text-night-text">{label}</span>
        {hint && <span className="font-body text-label text-ink-secondary dark:text-night-muted">{hint}</span>}
      </span>
    </label>
  )
}
