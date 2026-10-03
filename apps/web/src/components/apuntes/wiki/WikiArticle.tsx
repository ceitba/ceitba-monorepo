import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { KB_REPORT_REASONS, kbPagePath, reportKbPage, type KbPage, type KbPageSummary } from '../../../api/kb'
import { formatDate } from '../../../utils/apuntes'
import Notice from '../../Notice'
import ReportDialog from '../ReportDialog'
import KindIcon from '../KindIcon'
import YearBadge from '../YearBadge'
import { CitationContext, type CitationContextValue } from './citationContext'
import { citationOrder } from './wikilinks'

const WikiMarkdown = lazy(() => import('./WikiMarkdown'))

// One wiki page: AI disclaimer header, Markdown body (lazy chunk) in a ~70ch
// column, and a side panel (below on mobile) with sources, backlinks and
// any extra sections the caller passes (pages list, related subjects).
export default function WikiArticle({
  page,
  aside,
  showTitle = true,
}: {
  page: KbPage
  aside?: ReactNode
  showTitle?: boolean
}) {
  const { t, i18n } = useTranslation()
  // null: closed; otherwise the comment to prefill ('' for the header button).
  const [reporting, setReporting] = useState<{ comment: string; partial: boolean } | null>(null)
  const [highlighted, setHighlighted] = useState<string | null>(null)
  // "Basada en apuntes de 2020–2021": the API range, else the sources'.
  const yearsLabel = useMemo(() => {
    const years = (page.sources ?? []).map((x) => x.academicYear).filter((y): y is number => y != null)
    const min = page.sourceYears?.min ?? (years.length ? Math.min(...years) : null)
    const max = page.sourceYears?.max ?? (years.length ? Math.max(...years) : null)
    if (min == null && max == null) return null
    const range = min != null && max != null && min !== max ? `${min}–${max}` : String(max ?? min)
    return t('wiki.years.basedOn', { range })
  }, [page.sources, page.sourceYears, t])
  const order = useMemo(() => citationOrder(page.markdown ?? '', page.sources ?? []), [page.markdown, page.sources])
  const citations = useMemo<CitationContextValue>(() => ({
    order,
    highlighted,
    reportPart: (comment) => setReporting({ comment, partial: true }),
  }), [order, highlighted])
  const [reported, setReported] = useState(page.reportedByMe)
  const [notice, setNotice] = useState<string | null>(null)

  return (
    <CitationContext.Provider value={citations}>
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_18rem] gap-10">
      <article className="min-w-0">
        <header className="mb-6">
          {showTitle && (
            <h1 className="font-display font-bold text-h3 lg:text-h2 text-ink-primary dark:text-night-text break-words">
              {page.title}
            </h1>
          )}
          {page.summary && (
            <p className="font-body text-body-lg text-ink-secondary dark:text-night-muted mt-2 max-w-[70ch]">{page.summary}</p>
          )}
          {yearsLabel && (
            <p className="font-mono text-label text-ink-secondary dark:text-night-muted mt-2">{yearsLabel}</p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-sm bg-accent-50 dark:bg-accent-900/30 text-accent-800 dark:text-accent-200 font-body text-body-sm">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3l1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2z" />
              </svg>
              {t('wiki.aiLabel')}
            </span>
            <span className="font-mono text-label text-ink-secondary dark:text-night-muted">
              {t('wiki.generatedBy', { generator: page.generator, date: formatDate(page.generatedAt, i18n.language) })}
            </span>
            <button
              type="button"
              onClick={() => setReporting({ comment: '', partial: false })}
              disabled={reported}
              className="ml-auto font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted hover:text-red-600 dark:hover:text-red-400 disabled:opacity-60 disabled:hover:text-ink-secondary"
            >
              {reported ? t('apuntes.file.alreadyReported') : t('wiki.report')}
            </button>
          </div>
        </header>

        {page.stale && (
          <p className="mb-6 max-w-[70ch] px-3 py-2 rounded-sm border border-border dark:border-night-border bg-page-bg dark:bg-night-bg font-body text-body-sm text-ink-secondary dark:text-night-muted">
            {t('wiki.years.stale')}
          </p>
        )}

        {notice && <Notice className="mb-6" onDismiss={() => setNotice(null)}>{notice}</Notice>}

        <Suspense fallback={<div aria-busy="true" className="flex flex-col gap-3 max-w-[70ch]">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-4 rounded-sm skeleton" />)}</div>}>
          <WikiMarkdown page={page} />
        </Suspense>
      </article>

      <aside className="flex flex-col gap-8 lg:sticky lg:top-24 lg:self-start lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto">
        <SourcesPanel page={page} order={order} onHighlight={setHighlighted} />
        <BacklinksPanel page={page} />
        {aside}
      </aside>

      {reporting && (
        <ReportDialog
          fileName={page.title}
          title={t('wiki.reportTitle')}
          intro={t('wiki.reportIntro', { title: page.title })}
          reasons={KB_REPORT_REASONS}
          initialReason={reporting.partial ? 'CONTENT_ERROR' : undefined}
          initialComment={reporting.comment}
          onSubmit={(reason, comment) => reportKbPage(page.id, { reason, comment })}
          onClose={() => setReporting(null)}
          onReported={() => {
            setReporting(null)
            setReported(true)
            setNotice(t('apuntes.report.thanks'))
          }}
        />
      )}
    </div>
    </CitationContext.Provider>
  )
}

export function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted mb-2 pb-1 border-b border-border dark:border-night-border">
        {title}
      </h2>
      {children}
    </section>
  )
}

// Sources numbered like the inline markers ([1] = first cited). Hovering or
// focusing one highlights its markers in the text.
function SourcesPanel({ page, order, onHighlight }: {
  page: KbPage
  order: string[]
  onHighlight: (id: string | null) => void
}) {
  const { t } = useTranslation()
  if (!page.sources?.length) return null
  const byId = new Map(page.sources.map((s) => [s.id, s]))
  const numbered = order.map((id, i) => ({ n: i + 1, source: byId.get(id) })).filter((x) => x.source)
  return (
    <PanelSection title={t('wiki.sources')}>
      <ol className="flex flex-col gap-2">
        {numbered.map(({ n, source: s }) => {
          const author = s!.author?.anonymous || !s!.author?.name ? t('apuntes.anonymousAuthor') : s!.author.name
          return (
            <li
              key={s!.id}
              className="flex items-start gap-2"
              onMouseEnter={() => onHighlight(s!.id)}
              onMouseLeave={() => onHighlight(null)}
              onFocus={() => onHighlight(s!.id)}
              onBlur={() => onHighlight(null)}
            >
              <span className="font-mono text-label text-ink-secondary dark:text-night-muted mt-0.5 flex-shrink-0">[{n}]</span>
              <div className="min-w-0">
                <Link to={`/apuntes/archivo/${encodeURIComponent(s!.id)}`} className="inline-flex items-start gap-1.5 font-body text-body-sm text-ink-primary dark:text-night-text hover:text-primary break-words">
                  <KindIcon kind={s!.kind} size={14} className="mt-1" />
                  <span>{s!.name}</span>
                </Link>
                <p className="font-mono text-label text-ink-secondary dark:text-night-muted">
                  {s!.academicYear != null && (
                    <><YearBadge variant="text" year={s!.academicYear} source={s!.academicYearSource} /> · </>
                  )}
                  {author}
                </p>
              </div>
            </li>
          )
        })}
      </ol>
    </PanelSection>
  )
}

function BacklinksPanel({ page }: { page: KbPage }) {
  const { t } = useTranslation()
  if (!page.backlinks?.length) return null
  return (
    <PanelSection title={t('wiki.backlinks')}>
      <ul className="flex flex-col gap-1.5">
        {page.backlinks.map((b) => (
          <li key={`${b.subjectId}/${b.slug}`}>
            <Link to={kbPagePath(b.subjectId, b.slug)} className="font-body text-body-sm text-ink-primary dark:text-night-text hover:text-primary">
              {b.subjectId !== page.subjectId && (
                <span className="font-mono text-label text-ink-secondary dark:text-night-muted mr-1.5">{b.subjectId}</span>
              )}
              {b.title}
            </Link>
          </li>
        ))}
      </ul>
    </PanelSection>
  )
}

// "Páginas de esta materia", grouped by type: temas, then conceptos.
export function PagesPanel({ subjectId, pages, currentSlug, title }: {
  subjectId: string
  pages: KbPageSummary[]
  currentSlug?: string
  title?: string
}) {
  const { t } = useTranslation()
  const groups: { type: 'topic' | 'concept'; items: KbPageSummary[] }[] = [
    { type: 'topic', items: pages.filter((p) => p.type === 'topic') },
    { type: 'concept', items: pages.filter((p) => p.type === 'concept') },
  ]
  if (groups.every((g) => g.items.length === 0)) return null
  return (
    <PanelSection title={title ?? t('wiki.pagesOfSubject')}>
      <div className="flex flex-col gap-4">
        {groups.filter((g) => g.items.length > 0).map((g) => (
          <div key={g.type}>
            <p className="font-body text-body-sm font-semibold text-ink-primary dark:text-night-text mb-1">{t(`wiki.types.${g.type}`)}</p>
            <ul className="flex flex-col gap-1">
              {[...g.items].sort((a, b) => a.title.localeCompare(b.title)).map((p) => (
                <li key={p.slug}>
                  <Link
                    to={kbPagePath(subjectId, p.slug)}
                    aria-current={p.slug === currentSlug ? 'page' : undefined}
                    title={p.summary}
                    className={`font-body text-body-sm hover:text-primary ${p.slug === currentSlug ? 'text-primary font-semibold' : 'text-ink-secondary dark:text-night-muted'}`}
                  >
                    {p.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </PanelSection>
  )
}
