import type { ReactNode } from 'react'

// On/off switch with its label right next to it (label left, switch right,
// in a compact group: never stretched across a wide card). Use for settings
// that apply immediately; use a checkbox inside forms that have a Save.
export default function Switch({
  checked,
  onChange,
  label,
  hint,
  disabled = false,
  role = 'switch',
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: ReactNode
  hint?: ReactNode
  disabled?: boolean
  // 'menuitemcheckbox' when the switch lives inside a menu.
  role?: 'switch' | 'menuitemcheckbox'
}) {
  return (
    <div className="max-w-xl">
      <button
        type="button"
        role={role}
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="inline-flex items-center gap-4 min-h-[44px] text-left font-body text-body-sm text-ink-primary dark:text-night-text disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <span className="leading-snug">{label}</span>
        <span
          aria-hidden="true"
          className={`relative inline-flex flex-shrink-0 w-10 h-6 rounded-full transition-colors duration-150 ${
            checked ? 'bg-primary dark:bg-primary-400' : 'bg-border dark:bg-night-border'
          }`}
        >
          <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-card transition-transform duration-150 ${checked ? 'translate-x-4' : ''}`} />
        </span>
      </button>
      {hint && <p className="font-body text-label text-ink-secondary dark:text-night-muted">{hint}</p>}
    </div>
  )
}
