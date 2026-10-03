import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '../Modal'
import ErrorBanner from '../ErrorBanner'
import { createSource, type DriveInfo, type DriveSource } from '../../api/drive'
import { apuntesErrorMessage } from '../../utils/apuntes'
import { BTN_OUTLINE, BTN_PRIMARY, INPUT } from './buttons'

interface Props {
  info: DriveInfo
  onClose: () => void
  onConnected: (source: DriveSource) => void
}

// Very loose client-side check; the API is the authority
// (DRIVE_INVALID_FOLDER_URL). Accepts folder links and bare folder ids.
function looksLikeFolderUrl(value: string): boolean {
  const v = value.trim()
  return /drive\.google\.com\/.*folders\//.test(v) || /[?&]id=[\w-]{10,}/.test(v) || /^[\w-]{20,}$/.test(v)
}

// Two-step "Conectar carpeta" wizard:
//   1. share the folder with the bot email as Viewer (and expect Drive's
//      "outside your organization" warning),
//   2. paste the link, pick anonymous, accept the consent text.
export default function ConnectWizard({ info, onClose, onConnected }: Props) {
  const { t } = useTranslation()
  const [step, setStep] = useState<1 | 2>(1)
  const [copied, setCopied] = useState(false)
  const [folderUrl, setFolderUrl] = useState('')
  const [anonymous, setAnonymous] = useState(false)
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)

  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(info.botEmail)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard blocked (http, permissions): select the text instead.
      const el = document.getElementById('apuntes-bot-email')
      if (el) {
        const range = document.createRange()
        range.selectNodeContents(el)
        const sel = window.getSelection()
        sel?.removeAllRanges()
        sel?.addRange(range)
      }
    }
  }

  const urlLooksValid = looksLikeFolderUrl(folderUrl)
  const canSubmit = folderUrl.trim() !== '' && consent && !busy

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      const source = await createSource({
        folderUrl: folderUrl.trim(),
        consentVersion: info.consentVersion,
        anonymous,
      })
      onConnected(source)
    } catch (err) {
      setError(apuntesErrorMessage(err, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={t('apuntes.wizard.title')}
      onClose={onClose}
      busy={busy}
      size="2xl"
    >
      <ol className="flex gap-2 font-mono text-label uppercase tracking-widest" aria-label={t('apuntes.wizard.stepsAria')}>
        {[1, 2].map((n) => (
          <li
            key={n}
            aria-current={step === n ? 'step' : undefined}
            className={`flex-1 pb-1 border-b-2 ${step === n ? 'border-primary text-primary' : 'border-border dark:border-night-border text-ink-secondary dark:text-night-muted'}`}
          >
            {t(`apuntes.wizard.step${n}Label`)}
          </li>
        ))}
      </ol>

      {step === 1 && (
        <div className="flex flex-col gap-4 font-body text-body-sm text-ink-primary dark:text-night-text">
          <p className="text-ink-secondary dark:text-night-muted">{t('apuntes.wizard.step1Intro')}</p>
          <ol className="list-decimal pl-5 flex flex-col gap-3">
            <li>{t('apuntes.wizard.step1Open')}</li>
            <li>
              {t('apuntes.wizard.step1Add')}
              <div className="mt-2 flex flex-col sm:flex-row sm:items-center gap-2">
                <code
                  id="apuntes-bot-email"
                  className="flex-1 min-w-0 break-all px-3 py-2 rounded-sm bg-page-bg dark:bg-night-bg border border-border dark:border-night-border font-mono text-body-sm select-all"
                >
                  {info.botEmail}
                </code>
                <button type="button" onClick={copyEmail} className={BTN_OUTLINE}>
                  {copied ? t('apuntes.wizard.copied') : t('apuntes.wizard.copy')}
                </button>
              </div>
            </li>
            <li>{t('apuntes.wizard.step1Viewer')}</li>
          </ol>
          <div className="px-3 py-3 rounded-sm border border-accent-200 bg-accent-50 dark:bg-accent-900/30 dark:border-accent-800 text-accent-800 dark:text-accent-200">
            <p className="font-semibold">{t('apuntes.wizard.warningTitle')}</p>
            <p className="mt-1">{t('apuntes.wizard.warningBody')}</p>
          </div>
          <p className="text-ink-secondary dark:text-night-muted">{t('apuntes.wizard.step1Scope')}</p>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
              {t('manage.cancel')}
            </button>
            <button type="button" onClick={() => setStep(2)} className={BTN_PRIMARY}>
              {t('apuntes.wizard.shared')}
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <form onSubmit={submit} className="flex flex-col gap-5 font-body text-body-sm text-ink-primary dark:text-night-text" noValidate>
          {error && <ErrorBanner onDismiss={() => setError(null)}>{error}</ErrorBanner>}

          <label className="flex flex-col gap-1">
            <span className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
              {t('apuntes.wizard.folderUrl')}
            </span>
            <input
              type="url"
              inputMode="url"
              autoComplete="off"
              value={folderUrl}
              onChange={(e) => setFolderUrl(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder="https://drive.google.com/drive/folders/…"
              className={INPUT}
              aria-invalid={touched && folderUrl.trim() !== '' && !urlLooksValid}
              autoFocus
            />
            {touched && folderUrl.trim() !== '' && !urlLooksValid ? (
              <span className="text-amber-700 dark:text-amber-300">{t('apuntes.wizard.folderUrlWarn')}</span>
            ) : (
              <span className="text-ink-secondary dark:text-night-muted">{t('apuntes.wizard.folderUrlHint')}</span>
            )}
          </label>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={anonymous}
              onChange={(e) => setAnonymous(e.target.checked)}
              className="mt-1 h-4 w-4 accent-primary"
            />
            <span>
              <span className="font-semibold">{t('apuntes.wizard.anonymous')}</span>
              <span className="block text-ink-secondary dark:text-night-muted">{t('apuntes.wizard.anonymousHint')}</span>
            </span>
          </label>

          <div className="flex flex-col gap-2">
            <span className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
              {t('apuntes.wizard.consentTitle')}
            </span>
            <div className="max-h-48 overflow-y-auto px-3 py-2 rounded-sm border border-border dark:border-night-border bg-page-bg dark:bg-night-bg whitespace-pre-line text-ink-secondary dark:text-night-muted">
              {info.consentText}
            </div>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-1 h-4 w-4 accent-primary"
              />
              <span>{t('apuntes.wizard.consentAccept')}</span>
            </label>
          </div>

          <div className="flex flex-wrap justify-between gap-2 pt-2">
            <button type="button" disabled={busy} onClick={() => setStep(1)} className="px-3 py-1.5 font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted disabled:opacity-50">
              ← {t('apuntes.wizard.back')}
            </button>
            <button type="submit" disabled={!canSubmit} className={BTN_PRIMARY}>
              {busy ? t('apuntes.wizard.connecting') : t('apuntes.wizard.connect')}
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}
