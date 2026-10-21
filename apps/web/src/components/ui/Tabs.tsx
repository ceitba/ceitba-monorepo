import { useRef, type KeyboardEvent, type ReactNode } from 'react'

export interface TabItem<T extends string> {
  id: T
  label: ReactNode
  // Live count shown next to the label (omit when unknown; never show 0 as a guess).
  count?: number | null
  // Small dot that flags something new behind the tab.
  dot?: boolean
  dotLabel?: string
}

// The one tab strip for the site: mono uppercase labels with an underline
// on the active tab, WAI-ARIA tabs semantics (roving tabindex, arrow/Home/End
// keys). Scrolls sideways on narrow screens instead of wrapping.
//
// Give each panel id={`${idPrefix}-panel-${tab}`} and
// aria-labelledby={`${idPrefix}-tab-${tab}`} when rendering it.
export default function Tabs<T extends string>({
  items,
  active,
  onChange,
  label,
  idPrefix,
  className = '',
}: {
  items: TabItem<T>[]
  active: T
  onChange: (id: T) => void
  label: string
  idPrefix: string
  className?: string
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const i = items.findIndex((it) => it.id === active)
    let next = -1
    if (e.key === 'ArrowRight') next = (i + 1) % items.length
    else if (e.key === 'ArrowLeft') next = (i - 1 + items.length) % items.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = items.length - 1
    if (next < 0) return
    e.preventDefault()
    const id = items[next].id
    onChange(id)
    refs.current[id]?.focus()
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={`flex overflow-x-auto scrollbar-none border-b border-border dark:border-night-border ${className}`}
    >
      {items.map((it) => {
        const selected = it.id === active
        return (
          <button
            key={it.id}
            ref={(el) => { refs.current[it.id] = el }}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${it.id}`}
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel-${it.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(it.id)}
            className={[
              'relative shrink-0 inline-flex items-center gap-2 min-h-[44px] px-4 font-mono text-label uppercase tracking-widest transition-colors duration-150',
              selected
                ? 'text-primary dark:text-primary-300 font-bold'
                : 'text-ink-secondary dark:text-night-muted hover:text-ink-primary dark:hover:text-night-text',
            ].join(' ')}
          >
            {it.label}
            {it.count != null && (
              <span className="px-1.5 py-0.5 rounded-xs bg-primary-50 dark:bg-night-raised text-ink-secondary dark:text-night-muted font-mono text-label normal-case tracking-normal">
                {it.count}
              </span>
            )}
            {it.dot && (
              <span className="w-2 h-2 rounded-full bg-accent" role="img" aria-label={it.dotLabel} />
            )}
            {selected && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary dark:bg-primary-300 rounded-full" aria-hidden="true" />
            )}
          </button>
        )
      })}
    </div>
  )
}
