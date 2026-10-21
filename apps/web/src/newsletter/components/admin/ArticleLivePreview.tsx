import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import CategoryBadge from '../CategoryBadge'
import { formatDate } from '../../utils/dates'
import { bodyToMarkdown } from '../../utils/articleBody'
import ArticleBody from '../article/ArticleBody'
import type { IsoDate, Organization } from '../../types'

// Mirrors the GeoFill in ArticleCard — kept local so preview has no router dependency
const GEO_BG: Record<string, string> = {
  blue:   'bg-primary-500',
  amber:  'bg-accent-400',
  green:  'bg-emerald-600',
  violet: 'bg-violet-600',
}

// What the admin article form previews (its form state).
interface PreviewArticle {
  title?: string | null
  excerpt?: string | null
  body: string[]
  category: string
  organization?: string | null
  authors?: string[] | null
  date?: IsoDate | null
  readingTime?: string | null
  featured?: boolean
  colorScheme?: string | null
  coverImage?: string | null
}

type PreviewOrg = Pick<Organization, 'slug' | 'name'>

const muted = 'text-ink-secondary dark:text-night-muted'
const strong = 'text-ink-primary dark:text-night-text'
const cardShell = 'rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface overflow-hidden shadow-card'

// Stand-in for a field the writer hasn't filled yet.
function Missing({ children }: { children: ReactNode }) {
  return <span className={`${muted} italic`}>{children}</span>
}

interface CoverMediaProps {
  coverImage?: string | null
  colorScheme?: string | null
  className: string
}

function CoverMedia({ coverImage, colorScheme, className }: CoverMediaProps) {
  if (coverImage) {
    return (
      <div className={['overflow-hidden shrink-0', className].join(' ')}>
        <img src={coverImage} alt="" aria-hidden="true" className="w-full h-full object-cover" />
      </div>
    )
  }
  const bg = GEO_BG[colorScheme ?? ''] ?? GEO_BG.blue
  return (
    <div className={['relative overflow-hidden shrink-0', bg, className].join(' ')} aria-hidden="true">
      <div className="absolute inset-0 opacity-20">
        <div className="absolute top-[-20%] right-[-10%] w-2/3 h-2/3 rounded-full bg-white/30" />
        <div className="absolute bottom-[-15%] left-[-5%] w-1/2 h-1/2 rotate-45 bg-white/20" />
        <div className="absolute top-1/3 left-1/4 w-1/3 h-1/3 rounded-xs rotate-12 bg-black/10" />
      </div>
      <div className="absolute inset-0 bg-linear-to-br from-black/0 to-black/25" />
    </div>
  )
}

// ── Card preview ────────────────────────────────────────────────────────────

function PreviewCard({ article, featured }: { article: PreviewArticle; featured?: boolean }) {
  const { t, i18n } = useTranslation()
  const title = article.title || <Missing>{t('admin.preview.noTitle')}</Missing>
  const excerpt = article.excerpt || <Missing>{t('admin.preview.noExcerpt')}</Missing>
  const authors = (article.authors ?? []).join(', ') || t('admin.preview.noAuthors')
  const date = formatDate(article.date, i18n.language)

  if (featured) {
    return (
      <div className={`${cardShell} flex flex-col lg:flex-row`}>
        <CoverMedia coverImage={article.coverImage} colorScheme={article.colorScheme} className="h-48 lg:h-auto lg:w-1/2" />
        <div className="p-6 lg:p-8 flex flex-col justify-between gap-4">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <CategoryBadge category={article.category} />
              <span className={`font-mono text-label uppercase tracking-widest ${muted}`}>{t('admin.preview.featured')}</span>
            </div>
            <h2 className={`font-display text-h2 font-bold leading-tight ${strong}`}>{title}</h2>
            <p className={`font-body text-body leading-relaxed line-clamp-3 ${muted}`}>{excerpt}</p>
          </div>
          <footer className={`flex items-center gap-3 pt-2 border-t border-border dark:border-night-border ${muted}`}>
            <time className="font-mono text-label">{date}</time>
            <span aria-hidden="true">·</span>
            <span className="font-body text-body-sm">{authors}</span>
            {article.readingTime && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-label">{article.readingTime}</span>
              </>
            )}
          </footer>
        </div>
      </div>
    )
  }

  return (
    <div className={`${cardShell} flex flex-col`}>
      <CoverMedia coverImage={article.coverImage} colorScheme={article.colorScheme} className="h-44" />
      <div className="p-5 flex flex-col gap-3">
        <CategoryBadge category={article.category} />
        <h3 className={`font-display text-h5 font-bold leading-snug line-clamp-2 ${strong}`}>{title}</h3>
        <p className={`font-body text-body-sm leading-relaxed line-clamp-2 ${muted}`}>{excerpt}</p>
        <footer className={`flex items-center gap-3 pt-2 border-t border-border dark:border-night-border ${muted}`}>
          <time className="font-mono text-label">{date}</time>
          <span aria-hidden="true">·</span>
          <span className="font-body text-body-sm truncate">{authors}</span>
        </footer>
      </div>
    </div>
  )
}

// ── Full article preview ────────────────────────────────────────────────────

function ArticleFullPreview({ article, orgs }: { article: PreviewArticle; orgs: PreviewOrg[] }) {
  const { t, i18n } = useTranslation()
  const heroBg = GEO_BG[article.colorScheme ?? ''] ?? GEO_BG.blue
  const org = orgs.find((o) => o.slug === article.organization)

  return (
    <div className="bg-page-bg dark:bg-night-bg rounded-card border border-border dark:border-night-border overflow-hidden">
      {/* Hero */}
      {article.coverImage ? (
        <div className="h-56 overflow-hidden">
          <img src={article.coverImage} alt="" className="w-full h-full object-cover" />
        </div>
      ) : (
        <div className={['relative h-44 overflow-hidden', heroBg].join(' ')}>
          <div className="absolute inset-0 opacity-20" aria-hidden="true">
            <div className="absolute top-[-20%] right-[-5%] w-1/2 h-full rounded-full bg-white/30" />
            <div className="absolute bottom-[-30%] left-[-5%] w-2/3 h-2/3 rotate-12 bg-white/20" />
          </div>
          <div className="absolute inset-0 bg-linear-to-br from-black/0 to-black/30" aria-hidden="true" />
          <div className="absolute bottom-4 left-5">
            <CategoryBadge category={article.category} />
          </div>
        </div>
      )}

      {/* Content */}
      <div className="p-6 lg:p-8">
        {article.coverImage && (
          <div className="mb-3">
            <CategoryBadge category={article.category} />
          </div>
        )}

        <h2 className={`font-display text-h2 font-bold leading-tight ${strong}`}>
          {article.title || <Missing>{t('admin.preview.noTitle')}</Missing>}
        </h2>

        <div className={`flex flex-wrap items-center gap-3 mt-3 pb-5 border-b border-border dark:border-night-border ${muted}`}>
          <span className="font-body text-body-sm">
            {t('articles.meta.by')} <strong className={`font-semibold ${strong}`}>{(article.authors ?? []).join(', ') || t('admin.preview.noAuthors')}</strong>
          </span>
          <span aria-hidden="true">·</span>
          <time className="font-mono text-label">{formatDate(article.date, i18n.language)}</time>
          {article.readingTime && (
            <>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-label">{article.readingTime}</span>
            </>
          )}
          {org && (
            <>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-label">{org.name}</span>
            </>
          )}
        </div>

        {bodyToMarkdown(article.body).trim() ? (
          <ArticleBody body={article.body} className="mt-6" />
        ) : (
          <p className="mt-6 font-body text-body"><Missing>{t('admin.preview.noBody')}</Missing></p>
        )}
      </div>
    </div>
  )
}

// ── Public export ────────────────────────────────────────────────────────────

interface ArticleLivePreviewProps {
  article: PreviewArticle
  orgs?: PreviewOrg[]
}

export default function ArticleLivePreview({ article, orgs = [] }: ArticleLivePreviewProps) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-10">
      <section>
        <PreviewLabel>{t('admin.preview.card')}</PreviewLabel>
        <div className="max-w-sm">
          <PreviewCard article={article} />
        </div>
      </section>

      {article.featured && (
        <section>
          <PreviewLabel>{t('admin.preview.featuredCard')}</PreviewLabel>
          <PreviewCard article={article} featured />
        </section>
      )}

      <section>
        <PreviewLabel>{t('admin.preview.full')}</PreviewLabel>
        <ArticleFullPreview article={article} orgs={orgs} />
      </section>
    </div>
  )
}

function PreviewLabel({ children }: { children: ReactNode }) {
  return (
    <h4 className={`font-mono text-label uppercase tracking-widest mb-3 flex items-center gap-2 ${muted}`}>
      <span className="inline-block w-2 h-2 rounded-full bg-accent" aria-hidden="true" />
      {children}
    </h4>
  )
}
