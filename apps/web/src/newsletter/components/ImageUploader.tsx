import { useState, useRef, type DragEvent } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { ALLOWED_IMAGE_TYPES as ALLOWED_TYPES, MAX_IMAGE_BYTES as MAX_BYTES, uploadViaSignedUrl } from '../api/media'
import { ApiError } from '@/api/client'
import { Alert, Button, CloseIcon, IconButton, ToggleGroup, inputClass } from '@/components/ui'
import { isStaff } from '../store/authStore'
import { useAuthSession } from '../hooks/useAuthSession'

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}

interface ImageUploaderProps {
  // Current image URL ('' or nullish = none).
  value?: string | null
  onChange: (url: string) => void
}

type Tab = 'upload' | 'url'

// Cover image picker. Staff can upload a file (presigned upload to object
// storage); everyone else — and staff too — can paste an image URL. There
// is deliberately no base64/data-URL fallback: it stored megabytes of
// image data inside the article row.
export default function ImageUploader({ value, onChange }: ImageUploaderProps) {
  const { t } = useTranslation()
  const { profile } = useAuthSession()
  const canUpload = isStaff(profile)
  const [tab, setTab]         = useState<Tab>(value?.startsWith('http') ? 'url' : 'upload')
  const [url, setUrl]         = useState(value?.startsWith('http') ? value : '')
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const hasImage = Boolean(value)
  const activeTab = canUpload ? tab : 'url'

  async function handleFile(file: File | undefined) {
    if (!file) return
    if (!ALLOWED_TYPES.includes(file.type)) { setError(t('imageUploader.errors.type')); return }
    if (file.size > MAX_BYTES) { setError(t('imageUploader.errors.size')); return }
    setError('')
    setLoading(true)
    try {
      onChange(await uploadViaSignedUrl(file))
    } catch (err) {
      const status = err instanceof ApiError ? err.status : undefined
      setError(
        status === 501 ? t('imageUploader.errors.notConfigured')
          : status === 403 ? t('imageUploader.errors.forbidden')
          : t('imageUploader.errors.upload'),
      )
    } finally {
      setLoading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  function applyUrl() {
    const next = url.trim()
    if (!next) return
    if (!isHttpUrl(next)) { setError(t('imageUploader.errors.url')); return }
    setError('')
    onChange(next)
  }

  return (
    <div className="flex flex-col gap-3">
      {hasImage && (
        <div className="relative rounded-card overflow-hidden border border-border dark:border-night-border">
          <img
            src={value ?? undefined}
            alt={t('imageUploader.previewAlt')}
            className="w-full h-40 object-cover"
            onError={() => { setError(t('imageUploader.errors.load')); onChange('') }}
          />
          <IconButton
            onClick={() => { onChange(''); setUrl('') }}
            aria-label={t('imageUploader.remove')}
            className="absolute top-1 right-1 !bg-black/60 !text-white hover:!bg-black/75"
          >
            <CloseIcon size={16} />
          </IconButton>
        </div>
      )}

      {canUpload && (
        <ToggleGroup<Tab>
          joined
          className="self-start"
          label={t('imageUploader.source')}
          value={activeTab}
          onChange={(key) => { setTab(key); setError('') }}
          options={[
            { value: 'upload', label: t('imageUploader.uploadTab') },
            { value: 'url', label: t('imageUploader.urlTab') },
          ]}
        />
      )}

      {activeTab === 'upload' && (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click() }}
          aria-label={t('imageUploader.dropzone')}
          className="border-2 border-dashed border-border dark:border-night-border rounded-card p-6 text-center cursor-pointer hover:border-primary hover:bg-primary-50 dark:hover:bg-primary-800 transition-colors duration-150 focus-visible:rounded-card"
        >
          {loading ? (
            <p className="font-body text-body-sm text-ink-secondary">{t('imageUploader.uploading')}</p>
          ) : (
            <>
              <svg className="mx-auto mb-2 text-ink-secondary" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              <p className="font-body text-body-sm text-ink-secondary">
                <Trans i18nKey="imageUploader.dropHint" components={{ 1: <span className="text-primary underline" /> }} />
              </p>
              <p className="font-mono text-label text-ink-secondary mt-1">{t('imageUploader.limits')}</p>
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            accept={ALLOWED_TYPES.join(',')}
            className="sr-only"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        </div>
      )}

      {activeTab === 'url' && (
        <div
          className="flex gap-2"
        >
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyUrl() } }}
            placeholder="https://…"
            aria-label={t('imageUploader.urlLabel')}
            aria-invalid={Boolean(error) || undefined}
            className={inputClass({ invalid: Boolean(error), className: 'flex-1' })}
          />
          <Button variant="outline" onClick={applyUrl} disabled={!url.trim()}>
            {t('imageUploader.apply')}
          </Button>
        </div>
      )}

      {error && <Alert tone="error">{error}</Alert>}

      {!hasImage && (
        <p className="font-mono text-label text-ink-secondary">
          {t('imageUploader.noImage')}
        </p>
      )}
    </div>
  )
}
