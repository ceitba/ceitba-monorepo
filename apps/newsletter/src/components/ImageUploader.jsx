import { useState, useRef } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { apiSend } from '../api/client'
import { isStaff } from '../store/authStore'
import { useAuthSession } from '../hooks/useAuthSession'

// What POST /media/sign-upload accepts (MediaUploadService): STAFF only,
// jpeg/png/webp up to 5 MB.
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_BYTES     = 5 * 1024 * 1024

// Browsers refuse to set these on fetch; they are computed from the body.
const FORBIDDEN_HEADERS = new Set(['content-length', 'host'])

async function uploadViaSignedUrl(file) {
  const signed = await apiSend('POST', '/media/sign-upload', {
    filename:    file.name,
    contentType: file.type,
    sizeBytes:   file.size,
  })
  const headers = Object.fromEntries(
    Object.entries(signed.headers ?? { 'Content-Type': file.type })
      .filter(([k]) => !FORBIDDEN_HEADERS.has(k.toLowerCase())),
  )
  const putRes = await fetch(signed.uploadUrl, {
    method:  signed.method ?? 'PUT',
    headers,
    body:    file,
  })
  if (!putRes.ok) throw new Error('PUT to storage failed')
  return signed.publicUrl
}

function isHttpUrl(value) {
  try {
    const u = new URL(value)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}

// Cover image picker. Staff can upload a file (presigned upload to object
// storage); everyone else — and staff too — can paste an image URL. There
// is deliberately no base64/data-URL fallback: it stored megabytes of
// image data inside the article row.
export default function ImageUploader({ value, onChange }) {
  const { t } = useTranslation()
  const { profile } = useAuthSession()
  const canUpload = isStaff(profile)
  const [tab, setTab]         = useState(value?.startsWith('http') ? 'url' : 'upload')
  const [url, setUrl]         = useState(value?.startsWith('http') ? value : '')
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)
  const inputRef = useRef(null)

  const hasImage = Boolean(value)
  const activeTab = canUpload ? tab : 'url'

  async function handleFile(file) {
    if (!file) return
    if (!ALLOWED_TYPES.includes(file.type)) { setError(t('imageUploader.errors.type')); return }
    if (file.size > MAX_BYTES) { setError(t('imageUploader.errors.size')); return }
    setError('')
    setLoading(true)
    try {
      onChange(await uploadViaSignedUrl(file))
    } catch (err) {
      setError(
        err?.status === 501 ? t('imageUploader.errors.notConfigured')
          : err?.status === 403 ? t('imageUploader.errors.forbidden')
          : t('imageUploader.errors.upload'),
      )
    } finally {
      setLoading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  function handleDrop(e) {
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
        <div className="relative rounded-card overflow-hidden border border-border group">
          <img
            src={value}
            alt={t('imageUploader.previewAlt')}
            className="w-full h-40 object-cover"
            onError={() => { setError(t('imageUploader.errors.load')); onChange('') }}
          />
          <button
            type="button"
            onClick={() => { onChange(''); setUrl('') }}
            className="absolute top-2 right-2 w-7 h-7 bg-black/60 text-white rounded-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-150"
            aria-label={t('imageUploader.remove')}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      )}

      {canUpload && (
        <div className="flex rounded-sm border border-border overflow-hidden text-sm">
          {['upload', 'url'].map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => { setTab(key); setError('') }}
              className={[
                'flex-1 min-h-[36px] font-mono text-label uppercase tracking-widest transition-colors duration-150',
                activeTab === key ? 'bg-primary text-white' : 'text-ink-secondary hover:bg-surface',
              ].join(' ')}
            >
              {key === 'upload' ? t('imageUploader.uploadTab') : t('imageUploader.urlTab')}
            </button>
          ))}
        </div>
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
          className="border-2 border-dashed border-border rounded-card p-6 text-center cursor-pointer hover:border-primary hover:bg-primary-50 transition-colors duration-150 focus-visible:rounded-card"
        >
          {loading ? (
            <p className="font-body text-body-sm text-ink-secondary">{t('imageUploader.uploading')}</p>
          ) : (
            <>
              <svg className="mx-auto mb-2 text-ink-secondary" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              <p className="font-body text-body-sm text-ink-secondary">
                <Trans i18nKey="imageUploader.dropHint" components={{ 1: <span className="text-primary underline" /> }} />
              </p>
              <p className="font-mono text-label text-border mt-1">{t('imageUploader.limits')}</p>
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            accept={ALLOWED_TYPES.join(',')}
            className="sr-only"
            onChange={(e) => handleFile(e.target.files[0])}
          />
        </div>
      )}

      {activeTab === 'url' && (
        <div className="flex gap-2">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyUrl() } }}
            placeholder="https://…"
            className="flex-1 min-h-[44px] px-3 py-2 border border-border rounded-sm font-body text-body text-ink-primary bg-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
          />
          <button
            type="button"
            onClick={applyUrl}
            disabled={!url.trim()}
            className="min-h-[44px] px-4 bg-primary text-surface font-body text-body-sm font-semibold rounded-sm hover:bg-primary-600 disabled:opacity-50 transition-colors duration-150"
          >
            {t('imageUploader.apply')}
          </button>
        </div>
      )}

      {error && <p className="font-body text-body-sm text-red-600">{error}</p>}

      {!hasImage && (
        <p className="font-mono text-label text-ink-secondary">
          {t('imageUploader.noImage')}
        </p>
      )}
    </div>
  )
}
