import { useTranslation } from 'react-i18next'
import type { Review } from '../../../api/reviews'
import { Alert, Badge, Button } from '../../ui'
import { joinNames } from './logic'

const LABEL = 'font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted'

// One review: term · commission, who taught it, difficulty and whether it's
// recommended, the comment. Every review but the caller's own gets "Me
// sirvió" and "Denunciar", with or without a comment: the professors it names
// can be wrong too (a student added as one), and reports are the remedy. The
// caller's own review gets Editar / Eliminar instead, without Eliminar while
// it is hidden by reports (the API refuses it; the notice says why).
export default function ReviewCard({
  review,
  professorName,
  busy,
  onHelpful,
  onReport,
  onEdit,
  onDelete,
}: {
  review: Review
  professorName: (id: string) => string | null
  busy?: boolean
  onHelpful: () => void
  onReport: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const { t, i18n } = useTranslation()
  const names = joinNames(
    review.professorIds.map(professorName).filter((n): n is string => !!n),
    i18n.language,
  )
  const comment = review.comment?.trim()

  return (
    <article className="rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface p-4 flex flex-col gap-2">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={LABEL}>
          {t('apuntes.reviews.term', { period: review.period, year: review.year })}
          {' · '}
          {t('apuntes.reviews.commission', { commission: review.commission })}
        </span>
        {names && <span className="font-body text-body-sm font-semibold text-ink-primary dark:text-night-text">{names}</span>}
        {review.mine && <Badge tone="accent">{t('apuntes.reviews.mine')}</Badge>}
        <span className="sm:ml-auto flex flex-wrap gap-2">
          <Badge tone="neutral">{t(`apuntes.reviews.difficultyBadge.${review.difficulty}`)}</Badge>
          <Badge tone={review.recommend ? 'success' : 'warning'}>
            {t(review.recommend ? 'apuntes.reviews.recommends' : 'apuntes.reviews.notRecommends')}
          </Badge>
        </span>
      </header>

      {review.mine && review.hidden && <Alert tone="warning">{t('apuntes.reviews.hiddenNotice')}</Alert>}

      {comment && (
        <p className="font-body text-body text-ink-primary dark:text-night-text leading-[1.7] whitespace-pre-line wrap-break-word">
          {comment}
        </p>
      )}

      {review.mine ? (
        <footer className="flex flex-wrap items-center gap-1 -ml-3">
          <Button size="sm" variant="ghost" onClick={onEdit}>{t('apuntes.reviews.edit')}</Button>
          {!review.hidden && (
            <Button size="sm" variant="dangerGhost" onClick={onDelete}>{t('apuntes.reviews.delete')}</Button>
          )}
        </footer>
      ) : (
        <footer className="flex flex-wrap items-center gap-1 -ml-3">
          <Button size="sm" variant="ghost" aria-pressed={review.helpful} disabled={busy} onClick={onHelpful}>
            {review.helpful && <span aria-hidden="true" className="mr-1">✓</span>}
            {t('apuntes.reviews.helpful', { count: review.helpfulCount })}
          </Button>
          <Button size="sm" variant="ghost" disabled={review.reported} onClick={onReport}>
            {t(review.reported ? 'apuntes.reviews.reported' : 'apuntes.reviews.report')}
          </Button>
        </footer>
      )}
    </article>
  )
}
