import type { ReactNode } from 'react'

export interface ToggleOption<T> {
  value: T
  label: ReactNode
  key?: string
}

// Filter/choice toggles from the editorial system (§7 "Filter/tab toggles"):
// mono uppercase, rounded-sm, active = bg-primary, aria-pressed. `joined`
// renders the single segmented control (few options, e.g. Claro | Oscuro);
// otherwise the buttons wrap as separate chips (filters with many values).
export default function ToggleGroup<T extends string | number | null>({
  options,
  value,
  onChange,
  label,
  labelledBy,
  joined = false,
  className = '',
}: {
  options: ToggleOption<T>[]
  value: T
  onChange: (value: T) => void
  // Accessible name of the group (or pass labelledBy for a visible label).
  label?: string
  labelledBy?: string
  joined?: boolean
  className?: string
}) {
  return (
    <div
      role="group"
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      className={
        joined
          ? `inline-flex rounded-sm border border-border dark:border-night-border overflow-hidden ${className}`
          : `flex flex-wrap gap-2 ${className}`
      }
    >
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.key ?? String(opt.value)}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={[
              'inline-flex items-center justify-center min-h-[44px] sm:min-h-[36px] px-3 font-mono text-label uppercase tracking-widest transition-colors duration-150',
              joined ? 'flex-1 border-l first:border-l-0 border-border dark:border-night-border' : 'rounded-sm border',
              active
                ? 'bg-primary text-white border-primary'
                : `text-ink-secondary dark:text-night-muted hover:text-primary dark:hover:text-primary-300 ${joined ? 'bg-white dark:bg-night-surface hover:bg-primary-50 dark:hover:bg-night-raised' : 'border-border dark:border-night-border hover:border-primary'}`,
            ].join(' ')}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
