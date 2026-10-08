import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { unsubscribeFromDigest } from '../api/digests'
import { newsletterPath } from '@/newsletter/paths'
import { ApiError } from '@/api/client'
import { Button, buttonClass } from '@/components/ui'

type UnsubscribeState = 'confirm' | 'loading' | 'done' | 'invalid' | 'error'

// Target of the one-click unsubscribe link in "La semana en ITBA" emails
// (/newsletter/unsubscribe?token=…). Works signed out: the token alone
// identifies the subscriber.
export default function UnsubscribePage() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  // 'confirm' → 'loading' → 'done' | 'invalid' | 'error'. Nothing is sent on
  // page load: email link scanners that execute JS would otherwise
  // unsubscribe people. One-click unsubscribe for mail clients is handled by
  // the List-Unsubscribe header on the API side.
  const [state, setState] = useState<UnsubscribeState>(token ? 'confirm' : 'invalid')

  function handleConfirm() {
    setState('loading')
    unsubscribeFromDigest(token)
      .then(() => setState('done'))
      .catch((err: unknown) => {
        console.error(err)
        setState(err instanceof ApiError && (err.status === 400 || err.code === 'INVALID_TOKEN') ? 'invalid' : 'error')
      })
  }

  const title = (key: string) => (
    <h1 className="font-display text-h4 sm:text-h3 font-bold text-ink-primary">{t(key)}</h1>
  )
  const hint = (key: string) => (
    <p className="font-body text-body text-ink-secondary leading-relaxed">{t(key)}</p>
  )

  return (
    <section className="max-w-content mx-auto px-4 sm:px-6 py-section-mobile lg:py-section">
      <div className="max-w-xl mx-auto bg-white dark:bg-night-surface rounded-card border border-border dark:border-night-border shadow-card overflow-hidden">
        <div className="relative h-20 bg-primary-900 overflow-hidden" aria-hidden="true">
          <div className="absolute top-[-40%] right-[-10%] w-1/2 h-[180%] rounded-full bg-primary-700/50" />
          <div className="absolute bottom-[-60%] left-[10%] w-1/3 h-full rotate-12 bg-accent/30" />
        </div>
        <div className="p-6 sm:p-8 flex flex-col gap-4" aria-live="polite">
          <p className="font-mono text-label uppercase tracking-widest text-ink-secondary">{t('digest.name')}</p>

          {(state === 'confirm' || state === 'loading') && (
            <>
              {title('digest.unsubscribe.confirmTitle')}
              {hint('digest.unsubscribe.confirmHint')}
              <Button
                onClick={handleConfirm}
                loading={state === 'loading'}
                loadingLabel={t('digest.unsubscribe.confirming')}
                className="self-start"
              >
                {t('digest.unsubscribe.confirm')}
              </Button>
            </>
          )}

          {state === 'done' && (
            <>
              {title('digest.unsubscribe.doneTitle')}
              {hint('digest.unsubscribe.doneHint')}
            </>
          )}

          {state === 'invalid' && (
            <>
              {title('digest.unsubscribe.invalidTitle')}
              {hint('digest.unsubscribe.invalidHint')}
            </>
          )}

          {state === 'error' && (
            <>
              {title('digest.unsubscribe.errorTitle')}
              {hint('digest.unsubscribe.errorHint')}
              <Button onClick={handleConfirm} className="self-start">
                {t('errors.retry')}
              </Button>
            </>
          )}

          <Link to={newsletterPath('/')} className={buttonClass({ variant: 'ghost', className: 'self-start' })}>
            {t('digest.unsubscribe.backHome')}
          </Link>
        </div>
      </div>
    </section>
  )
}
