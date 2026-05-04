import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import CategoryBadge from './CategoryBadge'

const GEO_FILLS = {
  blue:   'bg-primary-500',
  amber:  'bg-accent-400',
  green:  'bg-emerald-600',
  violet: 'bg-violet-600',
}

function CoverMedia({ coverImage, colorScheme, className, featured }) {
  if (coverImage) {
    return (
      <div className={['overflow-hidden flex-shrink-0', className].join(' ')}>
        <img
          src={coverImage}
          alt=""
          aria-hidden="true"
          className="w-full h-full object-cover"
          loading="lazy"
        />
      </div>
    )
  }

  const bg = GEO_FILLS[colorScheme] ?? GEO_FILLS.blue
  return (
    <div className={['relative overflow-hidden flex-shrink-0', bg, className].join(' ')}>
      <div className="absolute inset-0 opacity-20">
        <div className="absolute top-[-20%] right-[-10%] w-2/3 h-2/3 rounded-full bg-white/30" />
        <div className="absolute bottom-[-15%] left-[-5%] w-1/2 h-1/2 rotate-45 bg-white/20" />
        <div className="absolute top-1/3 left-1/4 w-1/3 h-1/3 rounded-sm rotate-12 bg-black/10" />
      </div>
      <div className="absolute inset-0 bg-gradient-to-br from-black/0 to-black/25" />
    </div>
  )
}

function formatDate(iso, lang) {
  return new Date(iso).toLocaleDateString(lang === 'en' ? 'en-US' : 'es-AR', {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

export default function ArticleCard({ article, featured = false }) {
  const { t, i18n } = useTranslation()
  const { id, title, excerpt, category, authors, date, readingTime, colorScheme, coverImage } = article
  const authorLine = (authors ?? []).join(', ')

  if (featured) {
    return (
      <Link
        to={`/articles/${id}`}
        className="group rounded-card border border-border bg-white overflow-hidden shadow-card hover:shadow-card-hover transition-shadow duration-200 flex flex-col lg:flex-row animate-fade-in focus-visible:rounded-card"
      >
        <CoverMedia
          coverImage={coverImage}
          colorScheme={colorScheme}
          className="h-56 lg:h-auto lg:w-1/2"
          featured
        />
        <div className="p-6 lg:p-10 flex flex-col justify-between gap-4">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <CategoryBadge category={category} />
              <span className="font-mono text-label text-ink-secondary">{t('articles.featured')}</span>
            </div>
            <h2 className="font-display text-h2 text-ink-primary font-bold leading-tight group-hover:text-primary transition-colors duration-150">
              {title}
            </h2>
            <p className="font-body text-body text-ink-secondary leading-relaxed line-clamp-3">
              {excerpt}
            </p>
          </div>
          <footer className="flex items-center gap-4 pt-2 border-t border-border">
            <time className="font-mono text-label text-ink-secondary" dateTime={date}>
              {formatDate(date, i18n.language)}
            </time>
            <span className="text-border" aria-hidden="true">·</span>
            <span className="font-body text-body-sm text-ink-secondary">{authorLine}</span>
            <span className="text-border" aria-hidden="true">·</span>
            <span className="font-mono text-label text-ink-secondary">
              {t('articles.meta.readingTime', { time: readingTime })}
            </span>
          </footer>
        </div>
      </Link>
    )
  }

  return (
    <Link
      to={`/articles/${id}`}
      className="group rounded-card border border-border bg-white overflow-hidden shadow-card hover:shadow-card-hover transition-shadow duration-200 flex flex-col animate-fade-in focus-visible:rounded-card"
    >
      <CoverMedia coverImage={coverImage} colorScheme={colorScheme} className="h-44" />
      <div className="p-5 flex flex-col gap-3 flex-1">
        <CategoryBadge category={category} />
        <h3 className="font-display text-h5 text-ink-primary font-bold leading-snug group-hover:text-primary transition-colors duration-150 line-clamp-2">
          {title}
        </h3>
        <p className="font-body text-body-sm text-ink-secondary leading-relaxed line-clamp-2 flex-1">
          {excerpt}
        </p>
        <footer className="flex items-center gap-3 pt-2 border-t border-border mt-auto">
          <time className="font-mono text-label text-ink-secondary" dateTime={date}>
            {formatDate(date, i18n.language)}
          </time>
          <span className="text-border" aria-hidden="true">·</span>
          <span className="font-body text-body-sm text-ink-secondary truncate">{authorLine}</span>
        </footer>
      </div>
    </Link>
  )
}
