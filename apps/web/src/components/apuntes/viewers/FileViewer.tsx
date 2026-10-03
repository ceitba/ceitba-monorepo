import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchOriginal, fileDownloadUrl, FileTooLargeError, type FileDetail } from '../../../api/drive'
import { formatSize } from '../../../utils/apuntes'
import { safeHttpUrl } from '../../../utils/url'
import KindIcon from '../KindIcon'
import { BTN_OUTLINE, BTN_PRIMARY } from '../buttons'
import DocxViewer, { ViewerLoading } from './DocxViewer'
import SheetViewer from './SheetViewer'
import TextViewer from './TextViewer'
import { detectOriginalViewer, extensionOf } from './detect'

// Above this we don't render client-side (docx/sheets/text): download card.
export const MAX_PREVIEW_BYTES = 15 * 1024 * 1024

type CardReason = 'unsupported' | 'tooLarge' | 'failed' | 'noContent' | 'blocked'

// Picks how to show a file in the browser, in order: Doc HTML, the PDF
// rendition (iframe), then the original by type (image, docx, sheet,
// notebook, text), else a download card. Any render failure falls back to
// the card.
export default function FileViewer({ file, html }: { file: FileDetail; html: string | null }) {
  if (html) {
    return (
      <div className="w-full max-w-4xl mx-auto bg-white dark:bg-night-surface rounded-card border border-border dark:border-night-border px-5 py-8 sm:px-10 sm:py-12">
        <div className="apunte-prose" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    )
  }
  if (file.exportBlocked) return <DownloadCard file={file} reason="blocked" />
  if (file.hasPdf) return <PdfFrame file={file} />
  if (!file.hasOriginal) return <DownloadCard file={file} reason="noContent" />

  const viewer = detectOriginalViewer(file)
  if (viewer === 'image') return <ImageView file={file} />
  if (viewer === 'none') return <DownloadCard file={file} reason="unsupported" />
  if (file.sizeBytes != null && file.sizeBytes > MAX_PREVIEW_BYTES) return <DownloadCard file={file} reason="tooLarge" />
  return <OriginalRenderer key={file.id} file={file} viewer={viewer} />
}

function PdfFrame({ file }: { file: FileDetail }) {
  const { t } = useTranslation()
  return (
    <div className="w-full flex flex-col gap-2">
      <iframe
        src={fileDownloadUrl(file.id, 'pdf', 'inline')}
        title={t('apuntes.file.viewerTitle', { name: file.name })}
        className="w-full h-[80vh] min-h-[420px] rounded-card border border-border dark:border-night-border bg-white"
      />
      {/* Mobile browsers often can't show PDFs inline: offer a way out. */}
      <p className="sm:hidden font-body text-body-sm text-ink-secondary dark:text-night-muted">
        {t('apuntes.viewer.pdfMobileHint')}{' '}
        <a href={fileDownloadUrl(file.id, 'pdf', 'inline')} target="_blank" rel="noopener noreferrer" className="text-primary underline">
          {t('apuntes.viewer.openPdf')}
        </a>
      </p>
    </div>
  )
}

// SVG originals are always served as attachments: fetch them and show a
// typed blob URL in an <img> (scripts never run in an <img>).
function useSvgObjectUrl(file: FileDetail, enabled: boolean): { url: string | null; failed: boolean } {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!enabled) return
    let objectUrl: string | null = null
    let cancelled = false
    fetchOriginal(file.id, MAX_PREVIEW_BYTES)
      .then(async (blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(new Blob([await blob.arrayBuffer()], { type: 'image/svg+xml' }))
        setUrl(objectUrl)
      })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [file.id, enabled])
  return { url, failed }
}

function ImageView({ file }: { file: FileDetail }) {
  const { t } = useTranslation()
  const isSvg = extensionOf(file.name) === 'svg' || /svg/i.test(file.originalMimeType ?? '')
  const svg = useSvgObjectUrl(file, isSvg)
  const [failed, setFailed] = useState(false)
  if (failed || svg.failed) return <DownloadCard file={file} reason="failed" />
  if (isSvg && !svg.url) return <ViewerLoading label={t('apuntes.viewer.loading')} />
  return (
    <div className="w-full flex justify-center rounded-card border border-border dark:border-night-border bg-page-bg dark:bg-night-bg p-2 sm:p-4">
      <img
        src={svg.url ?? fileDownloadUrl(file.id, 'original', 'inline')}
        alt={file.name}
        onError={() => setFailed(true)}
        className="max-w-full max-h-[80vh] object-contain"
      />
    </div>
  )
}

function OriginalRenderer({ file, viewer }: { file: FileDetail; viewer: 'docx' | 'sheet' | 'notebook' | 'text' }) {
  const { t } = useTranslation()
  const [blob, setBlob] = useState<Blob | null>(null)
  const [failure, setFailure] = useState<CardReason | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchOriginal(file.id, MAX_PREVIEW_BYTES)
      .then((b) => { if (!cancelled) setBlob(b) })
      .catch((e) => { if (!cancelled) setFailure(e instanceof FileTooLargeError ? 'tooLarge' : 'failed') })
    return () => { cancelled = true }
  }, [file.id])

  const fail = (e: unknown) => {
    console.warn('Apuntes viewer failed, falling back to download', e)
    setFailure('failed')
  }

  if (failure) return <DownloadCard file={file} reason={failure} />
  if (!blob) return <ViewerLoading label={t('apuntes.viewer.loading')} />
  if (viewer === 'docx') return <DocxViewer blob={blob} onError={fail} />
  if (viewer === 'sheet') return <SheetViewer blob={blob} isCsv={extensionOf(file.name) === 'csv' || /text\/csv/i.test(file.originalMimeType ?? '')} onError={fail} />
  return <TextViewer blob={blob} notebook={viewer === 'notebook'} onError={fail} />
}

export function DownloadCard({ file, reason }: { file: FileDetail; reason: CardReason }) {
  const { t } = useTranslation()
  const driveUrl = safeHttpUrl(file.driveUrl)
  const canDownload = reason !== 'blocked' && (file.hasOriginal || file.hasPdf)
  const variant = file.hasOriginal ? 'original' : 'pdf'
  return (
    <div className="w-full max-w-xl mx-auto flex flex-col items-center gap-4 text-center px-6 py-10 rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface animate-fade-in">
      <div className="w-16 h-16 rounded-full bg-primary-50 dark:bg-primary-900 flex items-center justify-center">
        <KindIcon kind={file.kind} size={30} />
      </div>
      <div className="min-w-0">
        <p className="font-display font-bold text-h5 text-ink-primary dark:text-night-text break-words">{file.name}</p>
        {file.sizeBytes != null && (
          <p className="font-mono text-label text-ink-secondary dark:text-night-muted mt-1">{formatSize(file.sizeBytes)}</p>
        )}
      </div>
      <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted max-w-md">
        {t(`apuntes.viewer.card.${reason}`)}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        {canDownload && (
          <a href={fileDownloadUrl(file.id, variant, 'attachment')} className={BTN_PRIMARY}>
            {t('apuntes.viewer.download')}
          </a>
        )}
        {driveUrl && (
          <a href={driveUrl} target="_blank" rel="noopener noreferrer" className={BTN_OUTLINE}>
            {t('apuntes.viewer.openInDrive')}
          </a>
        )}
      </div>
    </div>
  )
}
