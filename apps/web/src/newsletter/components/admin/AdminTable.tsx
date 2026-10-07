import type { ReactNode } from 'react'

// The newsletter admin's table look (articles, events, analytics): a card
// that scrolls sideways on narrow screens, with mono uppercase headers.
export function TableCard({ children, minWidth = 'min-w-[640px]' }: { children: ReactNode; minWidth?: string }) {
  return (
    <div className="bg-white dark:bg-night-surface rounded-card border border-border dark:border-night-border shadow-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className={`w-full ${minWidth}`}>{children}</table>
      </div>
    </div>
  )
}

export function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return (
    <th scope="col" className={`px-4 py-3 text-left whitespace-nowrap font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted ${className}`}>
      {children}
    </th>
  )
}

export const theadRowClass = 'border-b border-border dark:border-night-border bg-page-bg dark:bg-night-raised'
export const rowClass = 'border-b border-border dark:border-night-border last:border-b-0 hover:bg-page-bg dark:hover:bg-night-raised transition-colors duration-100'
