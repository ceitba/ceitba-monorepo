interface SkeletonCardProps {
  featured?: boolean
}

export default function SkeletonCard({ featured = false }: SkeletonCardProps) {
  return (
    <div
      className={[
        'rounded-card border border-border dark:border-night-border overflow-hidden bg-white dark:bg-night-surface',
        featured ? 'flex flex-col lg:flex-row' : '',
      ].join(' ')}
      aria-hidden="true"
    >
      {/* Image placeholder */}
      <div
        className={[
          'skeleton',
          featured ? 'h-56 lg:h-auto lg:w-1/2' : 'h-44',
        ].join(' ')}
      />

      {/* Text placeholders */}
      <div className={['p-5 flex flex-col gap-3', featured ? 'lg:p-8' : ''].join(' ')}>
        {/* Category badge */}
        <div className="skeleton h-4 w-16 rounded-xs" />

        {/* Headline */}
        <div className="flex flex-col gap-2">
          <div className={['skeleton rounded-xs h-6', featured ? 'w-4/5' : 'w-full'].join(' ')} />
          {featured && <div className="skeleton rounded-xs h-6 w-3/5" />}
        </div>

        {/* Excerpt */}
        <div className="flex flex-col gap-1.5">
          <div className="skeleton rounded-xs h-4 w-full" />
          <div className="skeleton rounded-xs h-4 w-4/5" />
        </div>

        {/* Meta */}
        <div className="flex gap-4 mt-1">
          <div className="skeleton rounded-xs h-3 w-20" />
          <div className="skeleton rounded-xs h-3 w-24" />
        </div>
      </div>
    </div>
  )
}
