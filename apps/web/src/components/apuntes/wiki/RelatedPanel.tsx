import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import type { KbRelated } from '../../../api/kb'
import { PanelSection } from './WikiArticle'

const REASON_STYLES: Record<string, string> = {
  PREREQUISITE: 'bg-primary-50 text-primary-700 dark:bg-primary-900 dark:text-primary-200',
  DEPENDENT: 'bg-accent-50 text-accent-700 dark:bg-accent-900/40 dark:text-accent-200',
  LINKED: 'bg-border text-ink-secondary dark:bg-night-border dark:text-night-muted',
}

// "Materias relacionadas": correlativas, subjects that need this one, and
// subjects whose wikis link here.
export default function RelatedPanel({ related }: { related: KbRelated[] }) {
  const { t } = useTranslation()
  if (!related?.length) return null
  return (
    <PanelSection title={t('wiki.related')}>
      <ul className="flex flex-col gap-2">
        {related.map((r) => (
          <li key={`${r.subjectId}-${r.reason}`} className="flex items-start justify-between gap-2">
            <Link
              to={`/apuntes/${encodeURIComponent(r.subjectId)}`}
              className="min-w-0 font-body text-body-sm text-ink-primary dark:text-night-text hover:text-primary"
            >
              <span className="font-mono text-label text-ink-secondary dark:text-night-muted mr-1.5">{r.subjectId}</span>
              {r.subjectName}
              {!r.hasWiki && <span className="ml-1 text-ink-secondary dark:text-night-muted">· {t('wiki.noWikiYet')}</span>}
            </Link>
            <span className={`flex-shrink-0 px-1.5 py-0.5 rounded-sm font-mono text-[0.65rem] uppercase tracking-widest ${REASON_STYLES[r.reason] ?? REASON_STYLES.LINKED}`}>
              {t(`wiki.reasons.${r.reason}`, { defaultValue: r.reason })}
            </span>
          </li>
        ))}
      </ul>
    </PanelSection>
  )
}
