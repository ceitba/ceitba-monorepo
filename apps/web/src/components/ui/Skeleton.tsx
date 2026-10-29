import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

// Loading placeholders. Every surface that fetches data shows the shape of
// what's coming (never a "Cargando…" line or a lone spinner); spinners and
// "…" are only for buttons whose action is running.

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded-xs ${className}`} aria-hidden="true" />
}

// Wraps skeletons so assistive tech hears one "Cargando" instead of nothing.
export function LoadingRegion({ children, className = '' }: { children: ReactNode; className?: string }) {
  const { t } = useTranslation()
  return (
    <div role="status" aria-busy="true" aria-live="polite" className={className}>
      <span className="sr-only">{t('ui.loading')}</span>
      {children}
    </div>
  )
}

export function SkeletonText({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  return (
    <div className={`flex flex-col gap-2 ${className}`} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={`h-4 ${i === lines - 1 && lines > 1 ? 'w-2/3' : 'w-full'}`} />
      ))}
    </div>
  )
}

// Table body placeholder: render inside <tbody>.
export function SkeletonRows({ rows = 5, cols }: { rows?: number; cols: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} aria-hidden="true" className="border-b border-border dark:border-night-border last:border-0">
          {Array.from({ length: cols }).map((_, c) => (
            <td key={c} className="px-3 py-3">
              <Skeleton className={`h-4 ${c === 0 ? 'w-3/4' : 'w-1/2'}`} />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

// A full table-shaped loading state (header + rows), for lists that render
// nothing until the first response.
export function SkeletonTable({ rows = 5, cols = 4, className = '' }: { rows?: number; cols?: number; className?: string }) {
  return (
    <LoadingRegion className={`rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface overflow-hidden ${className}`}>
      <div className="flex gap-4 px-3 py-3 border-b border-border dark:border-night-border bg-page-bg dark:bg-night-raised" aria-hidden="true">
        {Array.from({ length: cols }).map((_, c) => <Skeleton key={c} className="h-3 flex-1" />)}
      </div>
      <div aria-hidden="true">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex gap-4 px-3 py-3.5 border-b border-border dark:border-night-border last:border-0">
            {Array.from({ length: cols }).map((_, c) => <Skeleton key={c} className={`h-4 flex-1 ${c === 0 ? '' : 'opacity-70'}`} />)}
          </div>
        ))}
      </div>
    </LoadingRegion>
  )
}

export function SkeletonCards({ count = 6, className = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4', cardClassName = 'h-40' }: { count?: number; className?: string; cardClassName?: string }) {
  return (
    <LoadingRegion className={className}>
      {Array.from({ length: count }).map((_, i) => <div key={i} className={`skeleton rounded-card ${cardClassName}`} aria-hidden="true" />)}
    </LoadingRegion>
  )
}

// Form placeholder: label + input pairs.
export function SkeletonForm({ fields = 4, className = '' }: { fields?: number; className?: string }) {
  return (
    <LoadingRegion className={`flex flex-col gap-5 ${className}`}>
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2" aria-hidden="true">
          <Skeleton className="h-3 w-24" />
          <Skeleton className={i === fields - 1 ? 'h-28 w-full' : 'h-11 w-full'} />
        </div>
      ))}
    </LoadingRegion>
  )
}
