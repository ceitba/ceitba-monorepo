import type { ReactNode } from 'react'

// Status/label pill. One tone per meaning across the whole site:
//   success  done, published, active          (emerald)
//   warning  waiting on someone, needs review (amber)
//   danger   failed, blocked, removed         (red)
//   info     in progress, scheduled           (primary)
//   accent   highlighted, new                 (amber accent)
//   neutral  draft, private, inactive         (gray)
// Map backend enums to a tone AND a translated label at the call site;
// never print the raw enum.
export type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'accent' | 'neutral'

const TONES: Record<BadgeTone, string> = {
  success: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  warning: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  danger:  'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  info:    'bg-primary-50 text-primary-700 dark:bg-primary-900 dark:text-primary-200',
  accent:  'bg-accent-50 text-accent-700 dark:bg-accent-900/40 dark:text-accent-200',
  neutral: 'bg-border/60 text-ink-secondary dark:bg-night-border dark:text-night-muted',
}

// `tone={null}` drops the tone colors so `className` can carry a color pair
// that isn't a status (e.g. the newsletter's per-category colors); include
// its dark: variants there.
export default function Badge({ tone = 'neutral', children, title, className = '' }: { tone?: BadgeTone | null; children: ReactNode; title?: string; className?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center whitespace-nowrap px-2 py-0.5 rounded-sm font-mono text-label uppercase tracking-widest ${tone ? TONES[tone] : ''} ${className}`}
    >
      {children}
    </span>
  )
}
