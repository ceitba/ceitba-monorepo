import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { setDigestSubscription, unsubscribeFromDigest } from '../api/digests'
import { useAuthSession } from '../hooks/useAuthSession'

// Target of the one-click unsubscribe link in "La semana en ITBA" emails
// (/newsletter/unsubscribe?token=…). Works signed out: the token alone
// identifies the subscriber.
export default function UnsubscribePage() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const { profile } = useAuthSession()
  // 'loading' → 'done' | 'invalid' | 'error'
  const [state, setState] = useState(token ? 'loading' : 'invalid')
  const [attempt, setAttempt] = useState(0)
  const [resubscribe, setResubscribe] = useState('idle') // 'idle' | 'busy' | 'done' | 'error'
  // StrictMode mounts effects twice; the call is idempotent, but there is no
  // reason to send it twice.
  const sentRef = useRef(null)

  useEffect(() => {
    if (!token) return
    const key = `${token}#${attempt}`
    if (sentRef.current === key) return
    sentRef.current = key
    setState('loading')
    unsubscribeFromDigest(token)
      .then(() => setState('done'))
      .catch((err) => setState(err?.status === 400 || err?.code === 'INVALID_TOKEN' ? 'invalid' : 'error'))
  }, [token, attempt])

  async function handleResubscribe() {
    setResubscribe('busy')
    try {
      await setDigestSubscription(true)
      setResubscribe('done')
    } catch {
      setResubscribe('error')
    }
  }

  return (
    <section className="max-w-content mx-auto px-4 sm:px-6 py-section-mobile lg:py-section">
      <div className="max-w-xl mx-auto bg-white rounded-card border border-border shadow-card overflow-hidden">
        <div className="relative h-20 bg-primary-900 overflow-hidden" aria-hidden="true">
          <div className="absolute top-[-40%] right-[-10%] w-1/2 h-[180%] rounded-full bg-primary-700/50" />
          <div className="absolute bottom-[-60%] left-[10%] w-1/3 h-full rotate-12 bg-accent/30" />
        </div>
        <div className="p-6 sm:p-8 flex flex-col gap-4" aria-live="polite">
          <p className="font-mono text-label uppercase tracking-widest text-ink-secondary">{t('digest.name')}</p>

          {state === 'loading' && (
            <p className="font-body text-body text-ink-secondary" aria-busy="true">{t('digest.unsubscribe.loading')}</p>
          )}

          {state === 'done' && (
            <>
              <h1 className="font-display text-h4 sm:text-h3 font-bold text-ink-primary">{t('digest.unsubscribe.doneTitle')}</h1>
              <p className="font-body text-body text-ink-secondary leading-relaxed">{t('digest.unsubscribe.doneHint')}</p>
              {profile && resubscribe !== 'done' && (
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={handleResubscribe}
                    disabled={resubscribe === 'busy'}
                    className="self-start min-h-[44px] px-5 bg-white border border-border text-ink-primary font-body text-body-sm font-semibold rounded-sm hover:border-primary hover:text-primary transition-colors duration-150 disabled:opacity-60"
                  >
                    {t('digest.unsubscribe.resubscribe')}
                  </button>
                  {resubscribe === 'error' && (
                    <p role="alert" className="font-body text-body-sm text-red-600">{t('digest.unsubscribe.resubscribeError')}</p>
                  )}
                </div>
              )}
              {resubscribe === 'done' && (
                <p className="font-body text-body-sm text-emerald-700">{t('digest.unsubscribe.resubscribed')}</p>
              )}
            </>
          )}

          {state === 'invalid' && (
            <>
              <h1 className="font-display text-h4 sm:text-h3 font-bold text-ink-primary">{t('digest.unsubscribe.invalidTitle')}</h1>
              <p className="font-body text-body text-ink-secondary leading-relaxed">{t('digest.unsubscribe.invalidHint')}</p>
            </>
          )}

          {state === 'error' && (
            <>
              <h1 className="font-display text-h4 sm:text-h3 font-bold text-ink-primary">{t('digest.unsubscribe.errorTitle')}</h1>
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
            {t('digest.unsubscribe.backHome')}
          </Link>
        </div>
      </div>
    </section>
  )
}
