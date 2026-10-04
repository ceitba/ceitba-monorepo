import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { fetchCorrectionVote, sendCorrectionVote } from '../api/digests'
import { localeFor } from '../utils/dates'

// Same origin as the newsletter in production (Caddy serves /scheduler).
const SCHEDULER_URL = '/scheduler/'
const DAY_INDEX = { MONDAY: 0, TUESDAY: 1, WEDNESDAY: 2, THURSDAY: 3, FRIDAY: 4, SATURDAY: 5, SUNDAY: 6 }

// Error codes of GET/POST /v1/digests/correction-vote → page state.
const ERROR_STATES = {
  INVALID_TOKEN: 'invalid',
  TOKEN_EXPIRED: 'expired',
  CORRECTION_NOT_FOUND: 'notFound',
  CORRECTION_CLOSED: 'closed',
  EMAIL_NOT_ALLOWED: 'notAllowed',
}

// "lunes" / "Monday" for an API day name (2024-01-01 was a Monday).
function dayName(day, lang) {
  const i = DAY_INDEX[day]
  if (i === undefined) return day
  return new Date(Date.UTC(2024, 0, 1 + i)).toLocaleDateString(localeFor(lang), { weekday: 'long', timeZone: 'UTC' })
}

function SlotList({ title, slots, lang, emptyLabel, highlight }) {
  return (
    <div className={`rounded-sm border p-4 ${highlight ? 'border-primary bg-primary-50' : 'border-border bg-surface'}`}>
      <p className="font-mono text-label uppercase tracking-widest text-ink-secondary mb-2">{title}</p>
      {slots.length === 0 ? (
        <p className="font-body text-body-sm text-ink-secondary">{emptyLabel}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {slots.map((s) => (
            <li key={`${s.day}-${s.from}`} className="font-body text-body text-ink-primary">
              <span className="capitalize">{dayName(s.day, lang)}</span>{' '}
              <span className="font-mono text-body-sm">{s.from}–{s.to}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// Target of the "Sí, es así" / "No" buttons in "Tu cuatrimestre" of the
// weekly digest (/newsletter/correction?token=…&vote=confirm|reject). Works
// signed out: the signed token identifies the reader and the correction.
// Opening the page never votes (mail scanners follow links): `vote` only
// preselects the answer; the reader confirms it with a click.
export default function CorrectionVotePage() {
  const { t, i18n } = useTranslation()
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const suggested = params.get('vote') === 'reject' ? 'reject' : params.get('vote') === 'confirm' ? 'confirm' : null

  // 'loading' → 'ready' | 'done' | 'invalid' | 'expired' | 'notFound' | 'closed' | 'notAllowed' | 'error'
  const [state, setState] = useState(token ? 'loading' : 'invalid')
  const [correction, setCorrection] = useState(null)
  const [result, setResult] = useState(null) // { previousVote } after a vote
  const [busy, setBusy] = useState(null) // 'confirm' | 'reject' while posting
  const [voteError, setVoteError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const loadedRef = useRef(null)

  useEffect(() => {
    if (!token) return
    const key = `${token}#${attempt}`
    if (loadedRef.current === key) return
    loadedRef.current = key
    setState('loading')
    fetchCorrectionVote(token)
      .then((c) => {
        setCorrection(c)
        setState(c.open ? 'ready' : 'closed')
      })
      .catch((err) => setState(ERROR_STATES[err?.code] ?? 'error'))
  }, [token, attempt])

  async function vote(choice) {
    setBusy(choice)
    setVoteError(false)
    try {
      const res = await sendCorrectionVote(token, choice)
      setCorrection(res.correction)
      setResult({ previousVote: res.previousVote ?? null })
      setState('done')
    } catch (err) {
      const next = ERROR_STATES[err?.code]
      if (next) setState(next)
      else setVoteError(true)
    } finally {
      setBusy(null)
    }
  }

  const lang = i18n.language
  const title = (key) => (
    <h1 className="font-display text-h4 sm:text-h3 font-bold text-ink-primary">{t(key)}</h1>
  )
  const hint = (key) => (
    <p className="font-body text-body text-ink-secondary leading-relaxed">{t(key)}</p>
  )

  return (
    <section className="max-w-content mx-auto px-4 sm:px-6 py-section-mobile lg:py-section">
      <div className="max-w-xl mx-auto bg-white rounded-card border border-border shadow-card overflow-hidden">
        <div className="relative h-20 bg-primary-900 overflow-hidden" aria-hidden="true">
          <div className="absolute top-[-40%] right-[-10%] w-1/2 h-[180%] rounded-full bg-primary-700/50" />
          <div className="absolute bottom-[-60%] left-[10%] w-1/3 h-full rotate-12 bg-accent/30" />
        </div>
        <div className="p-6 sm:p-8 flex flex-col gap-4" aria-live="polite">
          <p className="font-mono text-label uppercase tracking-widest text-ink-secondary">
            {t('digest.name')} · {t('digest.correction.kicker')}
          </p>

          {state === 'loading' && (
            <p className="font-body text-body text-ink-secondary" aria-busy="true">{t('digest.correction.loading')}</p>
          )}

          {correction && (state === 'ready' || state === 'done' || state === 'closed') && (
            <>
              <h1 className="font-display text-h4 sm:text-h3 font-bold text-ink-primary">
                {t('digest.correction.title', { subject: correction.subjectName, commission: correction.commissionName })}
              </h1>
              {state !== 'done' && hint('digest.correction.lead')}
              <div className="grid gap-3 sm:grid-cols-2">
                <SlotList title={t('digest.correction.proposed')} slots={correction.proposed} lang={lang}
                  emptyLabel={t('digest.correction.noSlots')} highlight />
                <SlotList title={t('digest.correction.sga')} slots={correction.sga} lang={lang}
                  emptyLabel={t('digest.correction.noSlots')} />
              </div>
              <p className="font-mono text-body-sm text-ink-secondary">
                {t('digest.correction.counts', { confirms: correction.confirms, rejects: correction.rejects })}
              </p>
            </>
          )}

          {state === 'ready' && (
            <div className="flex flex-col gap-3">
              {correction.myVote
                ? <p className="font-body text-body-sm text-ink-secondary">{t(`digest.correction.currentVote_${correction.myVote}`)}</p>
                : <p className="font-body text-body-sm text-ink-secondary">{t('digest.correction.hint')}</p>}
              <div className="flex flex-wrap gap-3">
                {['confirm', 'reject'].map((choice) => {
                  const preselected = suggested === choice
                  const current = correction.myVote === choice.toUpperCase()
                  return (
                    <button
                      key={choice}
                      type="button"
                      onClick={() => vote(choice)}
                      disabled={busy !== null}
                      aria-pressed={current}
                      className={`min-h-[44px] px-5 font-body text-body-sm font-semibold rounded-sm transition-colors duration-150 disabled:opacity-60 ${
                        preselected || (!suggested && choice === 'confirm')
                          ? 'bg-primary text-surface hover:bg-primary-600'
                          : 'bg-white border border-border text-ink-primary hover:border-primary hover:text-primary'
                      } ${current ? 'ring-2 ring-accent ring-offset-2' : ''}`}
                    >
                      {busy === choice ? t('digest.correction.sending') : t(`digest.correction.${choice}`)}
                    </button>
                  )
                })}
              </div>
              {voteError && (
                <p role="alert" className="font-body text-body-sm text-red-600">{t('digest.correction.voteError')}</p>
              )}
            </div>
          )}

          {state === 'done' && (
            <div className="flex flex-col gap-2">
              <p className="font-display text-h5 font-bold text-emerald-700">{t('digest.correction.doneTitle')}</p>
              {result?.previousVote && (
                <p className="font-body text-body-sm text-ink-secondary">
                  {result.previousVote === correction.myVote ? t('digest.correction.doneUnchanged') : t('digest.correction.doneChanged')}
                </p>
              )}
              {correction.status === 'APPLIED' && (
                <p className="font-body text-body-sm text-ink-secondary">{t('digest.correction.applied')}</p>
              )}
              {correction.open && (
                <button
                  type="button"
                  onClick={() => setState('ready')}
                  className="self-start font-body text-body-sm font-semibold text-primary hover:underline underline-offset-2"
                >
                  {t('digest.correction.changeVote')}
                </button>
              )}
            </div>
          )}

          {state === 'closed' && (
            <>
              {!correction && title('digest.correction.closedTitle')}
              {correction && <p className="font-display text-h5 font-bold text-ink-primary">{t('digest.correction.closedTitle')}</p>}
              {hint('digest.correction.closedHint')}
            </>
          )}

          {state === 'expired' && (
            <>
              {title('digest.correction.expiredTitle')}
              {hint('digest.correction.expiredHint')}
              <a href={SCHEDULER_URL} className="self-start font-body text-body-sm font-semibold text-primary hover:underline underline-offset-2">
                {t('digest.correction.openScheduler')}
              </a>
            </>
          )}

          {state === 'invalid' && (
            <>
              {title('digest.correction.invalidTitle')}
              {hint('digest.correction.invalidHint')}
            </>
          )}

          {state === 'notFound' && title('digest.correction.notFoundTitle')}
          {state === 'notAllowed' && title('digest.correction.notAllowedTitle')}

          {state === 'error' && (
            <>
              {title('digest.correction.errorTitle')}
              <button
                type="button"
                onClick={() => setAttempt((a) => a + 1)}
                className="self-start min-h-[44px] px-5 bg-primary text-surface font-body font-semibold rounded-sm hover:bg-primary-600 transition-colors duration-150"
              >
                {t('admin.common.retry')}
              </button>
            </>
          )}

          <Link to="/" className="self-start font-body text-body-sm font-semibold text-primary hover:underline underline-offset-2">
            {t('digest.correction.backHome')}
          </Link>
        </div>
      </div>
    </section>
  )
}
