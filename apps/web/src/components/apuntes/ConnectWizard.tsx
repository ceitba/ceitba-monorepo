import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '../Modal'
import { Alert, Button, Field, inputClass } from '../ui'
import { createSource, type DriveInfo, type DriveSource } from '../../api/drive'
import { apuntesErrorCopy } from './errorCopy'

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
      setError(apuntesErrorCopy(err, t))
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
                <Button variant="outline" onClick={copyEmail}>
                  {copied ? t('apuntes.wizard.copied') : t('apuntes.wizard.copy')}
                </Button>
              </div>
            </li>
            <li>{t('apuntes.wizard.step1Viewer')}</li>
          </ol>
          <Alert tone="warning" title={t('apuntes.wizard.warningTitle')}>{t('apuntes.wizard.warningBody')}</Alert>
          <p className="text-ink-secondary dark:text-night-muted">{t('apuntes.wizard.step1Scope')}</p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>{t('ui.cancel')}</Button>
            <Button onClick={() => setStep(2)}>{t('apuntes.wizard.shared')}</Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <form onSubmit={submit} className="flex flex-col gap-5 font-body text-body-sm text-ink-primary dark:text-night-text" noValidate>
          {error && <Alert tone="error" onDismiss={() => setError(null)}>{error}</Alert>}

          {/* A doubtful link is only a warning (amber): the API decides. */}
          <Field
            label={t('apuntes.wizard.folderUrl')}
            hint={
              touched && folderUrl.trim() !== '' && !urlLooksValid
                ? <span className="text-amber-700 dark:text-amber-300">{t('apuntes.wizard.folderUrlWarn')}</span>
                : t('apuntes.wizard.folderUrlHint')
            }
          >
            {(p) => (
              <input
                {...p}
                type="url"
                inputMode="url"
                autoComplete="off"
                value={folderUrl}
                onChange={(e) => setFolderUrl(e.target.value)}
                onBlur={() => setTouched(true)}
                placeholder="https://drive.google.com/drive/folders/…"
                className={inputClass({ invalid: touched && folderUrl.trim() !== '' && !urlLooksValid })}
                autoFocus
              />
            )}
          </Field>

          <label className="flex items-start gap-3 min-h-[44px] cursor-pointer">
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
            <label className="flex items-start gap-3 min-h-[44px] cursor-pointer">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-1 h-4 w-4 accent-primary"
              />
              <span>{t('apuntes.wizard.consentAccept')}</span>
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            <Button variant="ghost" disabled={busy} onClick={() => setStep(1)}>
              <span aria-hidden="true">←</span> {t('apuntes.wizard.back')}
            </Button>
            <div className="flex flex-col items-end gap-1">
              <Button type="submit" disabled={!canSubmit} loading={busy} loadingLabel={t('apuntes.wizard.connecting')}>
                {t('apuntes.wizard.connect')}
              </Button>
              {!busy && !canSubmit && (
                <p className="font-body text-label text-ink-secondary dark:text-night-muted text-right">
                  {t(folderUrl.trim() === '' ? 'apuntes.wizard.needUrl' : 'apuntes.wizard.needConsent')}
                </p>
              )}
            </div>
          </div>
        </form>
      )}
    </Modal>
  )
}
