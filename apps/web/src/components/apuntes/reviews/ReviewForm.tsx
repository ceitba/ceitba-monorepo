import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../../../api/client'
import {
  MAX_COMMENT_LENGTH,
  MAX_COMMISSION_LENGTH,
  MAX_PROFESSORS_PER_REVIEW,
  createReview,
  lookupProfessor,
  updateReview,
  type Difficulty,
  type Professor,
  type Review,
} from '../../../api/reviews'
import { Alert, Button, Field, Modal, ToggleGroup, inputClass, selectClass, textareaClass, toast } from '../../ui'
import { apuntesErrorCopy } from '../errorCopy'
import {
  joinNames,
  parseTermKey,
  recentTerms,
  reportedTeam,
  sameTerm,
  suggestedProfessors,
  termKey,
  uniqueCommissions,
  type Term,
} from './logic'

const LABEL = 'font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted'
const HINT = 'font-body text-body-sm text-ink-secondary dark:text-night-muted'
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type YesNo = 'yes' | 'no'

// The review form, in a modal: term, commission, recommend, difficulty,
// who taught it (chips, pre-selected from what other students of the same
// commission said; more can be added by their ITBA email) and an optional
// comment. Save errors stay inside the modal.
export default function ReviewForm({
  subjectId,
  subjectName,
  reviews,
  professors,
  existing,
  onClose,
  onSaved,
}: {
  subjectId: string
  subjectName: string
  reviews: Review[]
  professors: Professor[]
  existing: Review | null
  onClose: () => void
  onSaved: () => void
}) {
  const { t, i18n } = useTranslation()
  const ids = { recommend: useId(), difficulty: useId(), professors: useId(), datalist: useId() }
  const lookupErrorId = useId()

  const terms = useMemo(() => {
    const list = recentTerms(4)
    if (existing && !list.some((x) => sameTerm(x, existing))) list.push({ year: existing.year, period: existing.period })
    return list
  }, [existing])

  const [term, setTerm] = useState<Term>(() => (existing ? { year: existing.year, period: existing.period } : terms[0]))
  const [commission, setCommission] = useState(existing?.commission ?? '')
  const [recommend, setRecommend] = useState<YesNo | null>(existing ? (existing.recommend ? 'yes' : 'no') : null)
  const [difficulty, setDifficulty] = useState<Difficulty | null>(existing?.difficulty ?? null)
  const [comment, setComment] = useState(existing?.comment ?? '')
  // null = follow the suggestion for the commission and term (until the
  // student picks by hand); editing starts from what the review says.
  const [manual, setManual] = useState<string[] | null>(existing ? existing.professorIds : null)
  const [added, setAdded] = useState<Professor[]>([])

  const [adding, setAdding] = useState(false)
  const [email, setEmail] = useState('')
  const [lookupBusy, setLookupBusy] = useState(false)
  const [lookupError, setLookupError] = useState<string | null>(null)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const others = useMemo(() => reviews.filter((r) => !r.mine), [reviews])
  const suggested = useMemo(
    () => (existing ? [] : suggestedProfessors(others, commission, term)),
    [existing, others, commission, term],
  )
  const selected = manual ?? suggested

  const known = useMemo(() => {
    const all = [...professors, ...added.filter((a) => !professors.some((p) => p.id === a.id))]
    // Reported for this commission and term first, then the rest by name.
    const rank = new Map(reportedTeam(others, commission, term).map((p, i) => [p.id, i]))
    return all.sort((a, b) =>
      (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) || a.name.localeCompare(b.name, i18n.language))
  }, [professors, added, others, commission, term, i18n.language])

  const nameOf = (id: string) => known.find((p) => p.id === id)?.name
  const suggestedShown = suggested.filter((id) => selected.includes(id)).map(nameOf).filter((n): n is string => !!n)
  const atLimit = selected.length >= MAX_PROFESSORS_PER_REVIEW

  function toggle(id: string) {
    setManual(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id])
  }

  async function find() {
    const value = email.trim().toLowerCase()
    if (!value || lookupBusy) return
    if (!EMAIL.test(value)) { setLookupError(t('apuntes.reviews.form.invalidEmail')); return }
    setLookupBusy(true); setLookupError(null)
    try {
      const p = await lookupProfessor(value)
      setAdded((a) => (a.some((x) => x.id === p.id) ? a : [...a, p]))
      if (!selected.includes(p.id) && !atLimit) setManual([...selected, p.id])
      setAdding(false); setEmail('')
      toast.success(t('apuntes.reviews.form.added', { name: p.name }))
    } catch (e) {
      setLookupError(e instanceof ApiError && e.code === 'ValidationError'
        ? t('apuntes.reviews.form.invalidEmail')
        : apuntesErrorCopy(e, t))
    } finally {
      setLookupBusy(false)
    }
  }

  const missing = [
    !commission.trim() && t('apuntes.reviews.form.missingParts.commission'),
    recommend == null && t('apuntes.reviews.form.missingParts.recommend'),
    difficulty == null && t('apuntes.reviews.form.missingParts.difficulty'),
  ].filter((x): x is string => !!x)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (missing.length > 0 || recommend == null || difficulty == null) return
    setBusy(true); setError(null)
    const body = {
      year: term.year,
      period: term.period,
      commission: commission.trim(),
      recommend: recommend === 'yes',
      difficulty,
      professorIds: selected,
      comment: comment.trim() || null,
    }
    try {
      if (existing) await updateReview(existing.id, body)
      else await createReview(subjectId, body)
      toast.success(t(existing ? 'apuntes.reviews.form.saved' : 'apuntes.reviews.form.published'))
      onSaved()
    } catch (err) {
      setError(apuntesErrorCopy(err, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={t('apuntes.reviews.form.title', { subject: subjectName })} size="lg" onClose={onClose} busy={busy}>
      <form onSubmit={submit} className="flex flex-col gap-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={t('apuntes.reviews.form.term')}>
            {(p) => (
              <select {...p} value={termKey(term)} onChange={(e) => setTerm(parseTermKey(e.target.value))} className={selectClass()}>
                {terms.map((x) => (
                  <option key={termKey(x)} value={termKey(x)}>{t('apuntes.reviews.term', { period: x.period, year: x.year })}</option>
                ))}
              </select>
            )}
          </Field>
          <Field label={t('apuntes.reviews.form.commission')}>
            {(p) => (
              <>
                <input
                  {...p}
                  value={commission}
                  maxLength={MAX_COMMISSION_LENGTH}
                  onChange={(e) => setCommission(e.target.value)}
                  placeholder={t('apuntes.reviews.form.commissionPlaceholder')}
                  list={ids.datalist}
                  autoComplete="off"
                  className={inputClass()}
                />
                <datalist id={ids.datalist}>
                  {uniqueCommissions(reviews).map((c) => <option key={c} value={c} />)}
                </datalist>
              </>
            )}
          </Field>
        </div>

        <div className="flex flex-col gap-1.5">
          <span id={ids.recommend} className={LABEL}>{t('apuntes.reviews.form.recommend')}</span>
          <ToggleGroup<YesNo | null>
            joined
            className="self-start"
            labelledBy={ids.recommend}
            value={recommend}
            onChange={setRecommend}
            options={[
              { value: 'yes', label: t('apuntes.reviews.form.yes') },
              { value: 'no', label: t('apuntes.reviews.form.no') },
            ]}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <span id={ids.difficulty} className={LABEL}>{t('apuntes.reviews.form.difficulty')}</span>
          <ToggleGroup<Difficulty | null>
            joined
            className="self-start"
            labelledBy={ids.difficulty}
            value={difficulty}
            onChange={setDifficulty}
            options={([1, 2, 3] as Difficulty[]).map((v) => ({ value: v, label: t(`apuntes.reviews.difficultyOption.${v}`) }))}
          />
        </div>

        <div className="flex flex-col gap-2">
          <span id={ids.professors} className={LABEL}>{t('apuntes.reviews.form.professors')}</span>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-labelledby={ids.professors}>
            {known.map((p) => {
              const on = selected.includes(p.id)
              return (
                <Button
                  key={p.id}
                  size="sm"
                  variant="outline"
                  pressed={on}
                  textCase="text"
                  disabled={!on && atLimit}
                  onClick={() => toggle(p.id)}
                >
                  {on && <span aria-hidden="true" className="mr-1">✓</span>}
                  {p.name}
                </Button>
              )
            })}
            {!adding && !atLimit && (
              <Button size="sm" variant="ghost" onClick={() => { setAdding(true); setLookupError(null) }}>
                {t('apuntes.reviews.form.addProfessor')}
              </Button>
            )}
          </div>
          {atLimit && <p className={HINT}>{t('apuntes.reviews.form.professorLimit', { count: MAX_PROFESSORS_PER_REVIEW })}</p>}
          {suggestedShown.length > 0 && (
            <p className={HINT}>
              {t('apuntes.reviews.form.suggested', { names: joinNames(suggestedShown, i18n.language), commission: commission.trim() })}
            </p>
          )}
          {adding && (
            <div className="flex flex-col gap-2 rounded-xs border border-border dark:border-night-border p-3">
              <div className="flex flex-wrap gap-2">
                <input
                  type="email"
                  value={email}
                  autoFocus
                  aria-label={t('apuntes.reviews.form.emailLabel')}
                  aria-invalid={!!lookupError}
                  aria-describedby={lookupError ? lookupErrorId : undefined}
                  placeholder={t('apuntes.reviews.form.emailPlaceholder')}
                  onChange={(e) => { setEmail(e.target.value); setLookupError(null) }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void find() } }}
                  className={inputClass({ invalid: !!lookupError, className: 'flex-1 min-w-48' })}
                />
                <Button
                  variant="outline"
                  disabled={!email.trim()}
                  loading={lookupBusy}
                  loadingLabel={t('apuntes.reviews.form.searching')}
                  onClick={() => void find()}
                >
                  {t('apuntes.reviews.form.search')}
                </Button>
                <Button variant="ghost" disabled={lookupBusy} onClick={() => { setAdding(false); setEmail(''); setLookupError(null) }}>
                  {t('ui.cancel')}
                </Button>
              </div>
              {lookupError && <div id={lookupErrorId}><Alert tone="warning">{lookupError}</Alert></div>}
            </div>
          )}
          <p className={HINT}>{t('apuntes.reviews.form.lookupHint')}</p>
        </div>

        <Field label={t('apuntes.reviews.form.comment')} hint={t('apuntes.reviews.form.commentHint')}>
          {(p) => (
            <textarea
              {...p}
              rows={4}
              value={comment}
              maxLength={MAX_COMMENT_LENGTH}
              onChange={(e) => setComment(e.target.value)}
              placeholder={t('apuntes.reviews.form.commentPlaceholder')}
              className={textareaClass()}
            />
          )}
        </Field>

        {error && <Alert tone="error" onDismiss={() => setError(null)}>{error}</Alert>}

        <div className="flex flex-wrap items-center justify-end gap-2">
          {missing.length > 0 && (
            <p className={`mr-auto ${HINT}`}>
              {t('apuntes.reviews.form.missing', { what: joinNames(missing, i18n.language) })}
            </p>
          )}
          <Button variant="ghost" disabled={busy} onClick={onClose}>{t('ui.cancel')}</Button>
          <Button type="submit" disabled={missing.length > 0} loading={busy}>
            {t(existing ? 'apuntes.reviews.form.save' : 'apuntes.reviews.form.publish')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
