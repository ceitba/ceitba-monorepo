// The one button vocabulary for the whole site (main pages, /manage, the
// scheduler and the newsletter): mono uppercase labels, rounded-sm, 44px
// touch targets. Use <Button> where you can; buttonClass() is for links and
// other elements that must look like a button.

export type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'danger' | 'dangerGhost' | 'accent'
export type ButtonSize = 'md' | 'sm'

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-sm font-mono text-label uppercase tracking-widest whitespace-nowrap ' +
  'transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:cursor-not-allowed'

// `sm` is for dense admin tables and toolbars: still 44px tall on touch
// screens, 36px from `sm:` up where a pointer is the norm.
const SIZES: Record<ButtonSize, string> = {
  md: 'min-h-[44px] px-4',
  sm: 'min-h-[44px] sm:min-h-[36px] px-3',
}

const VARIANTS: Record<ButtonVariant, string> = {
  // The single main action of a view.
  primary: 'bg-primary text-white hover:bg-primary-600',
  // Secondary actions.
  outline:
    'border border-border dark:border-night-border bg-white dark:bg-night-surface text-ink-primary dark:text-night-text hover:border-primary hover:text-primary',
  // Cancel and other low-emphasis actions.
  ghost: 'text-ink-secondary dark:text-night-muted hover:text-ink-primary dark:hover:text-night-text hover:bg-primary-50 dark:hover:bg-night-raised',
  // Confirming an irreversible action (inside ConfirmDialog).
  danger: 'bg-red-600 text-white hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600',
  // Entry point to a destructive action (opens the confirmation).
  dangerGhost: 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40',
  // Warm call to action, used sparingly (e.g. sending the digest).
  accent: 'bg-accent text-ink-primary hover:bg-accent-300',
}

export function buttonClass({
  variant = 'primary',
  size = 'md',
  block = false,
  className = '',
}: { variant?: ButtonVariant; size?: ButtonSize; block?: boolean; className?: string } = {}) {
  return [BASE, SIZES[size], VARIANTS[variant], block ? 'w-full' : '', className].filter(Boolean).join(' ')
}

// Square icon-only button. Always pass an aria-label, and only use it where
// the icon is universally understood (close ×, prev/next arrows, zoom).
export function iconButtonClass({ size = 'md', className = '' }: { size?: ButtonSize; className?: string } = {}) {
  const box = size === 'md' ? 'w-11 h-11' : 'w-11 h-11 sm:w-9 sm:h-9'
  return [
    'inline-flex items-center justify-center flex-shrink-0 rounded-sm transition-colors duration-150',
    'text-ink-secondary dark:text-night-muted hover:text-ink-primary dark:hover:text-night-text hover:bg-primary-50 dark:hover:bg-night-raised',
    'disabled:opacity-50 disabled:cursor-not-allowed',
    box,
    className,
  ].filter(Boolean).join(' ')
}
