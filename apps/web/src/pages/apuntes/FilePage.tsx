import '../../i18nApuntes'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { fetchFile, fileAssetsBaseUrl, fileDownloadUrl, type FileDetail } from '../../api/drive'
import { ApiError } from '../../api/client'
import { apuntesErrorMessage, authorName, formatDate, formatSize, isCommunity } from '../../utils/apuntes'
import CommunityBadge from '../../components/apuntes/CommunityBadge'
import EmptyState from '../../components/apuntes/EmptyState'
import FileViewer from '../../components/apuntes/viewers/FileViewer'
import { sanitizeHtml } from '../../utils/sanitize'
import { safeHttpUrl, trustedImageSrc } from '../../utils/url'
import KindIcon from '../../components/apuntes/KindIcon'
import YearBadge from '../../components/apuntes/YearBadge'
import ReportDialog from '../../components/apuntes/ReportDialog'
import Notice from '../../components/Notice'
import { BTN_OUTLINE, BTN_PRIMARY } from '../../components/apuntes/buttons'

// Doc HTML is sanitized server-side; sanitize again (defence in depth) and
// point embedded images at the API: they come as root-relative
// "/api/v1/wiki/files/{id}/assets/{name}", and the SPA may run on another
// origin in dev. Remote images (other origins) are dropped.
function prepareDocHtml(html: string, fileId: string): string {
  return sanitizeHtml(html, {
    rewriteImg: (src) => {
      const trusted = trustedImageSrc(src)
      if (trusted) return trusted
      if (!src.startsWith('/') && !/^[a-z]+:/i.test(src)) {
        return fileAssetsBaseUrl(fileId) + src.replace(/^\.?\/?(assets\/)?/, '')
      }
      return null
    },
  })
}

// /apuntes/archivo/:fileId — reader: header with downloads and report, and
// FileViewer for the content (Doc HTML, PDF, or the original rendered in
// the browser).
export default function FilePage() {
  const { fileId = '' } = useParams()
  const { t, i18n } = useTranslation()
  const [file, setFile] = useState<FileDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [tick, setTick] = useState(0)
  const [reporting, setReporting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const reqRef = useRef(0)

  useEffect(() => {
    const id = ++reqRef.current
    setLoading(true); setError(null); setNotFound(false)
    fetchFile(fileId)
      .then((res) => { if (reqRef.current === id) setFile(res) })
      .catch((e) => {
        if (reqRef.current !== id) return
        setFile(null)
        if (e instanceof ApiError && (e.status === 404 || e.status === 403)) setNotFound(true)
        else setError(apuntesErrorMessage(e, t))
      })
      .finally(() => { if (reqRef.current === id) setLoading(false) })
  }, [fileId, tick, t])

  const html = useMemo(
    () => (file?.html ? prepareDocHtml(file.html, file.id) : null),
    [file?.html, file?.id],
  )

  if (notFound) {
    return (
      <main id="main-content" className="container-content py-section-mobile lg:py-section">
        <EmptyState
          title={t('apuntes.file.notFoundTitle')}
          body={t('apuntes.file.notFoundBody')}
          action={<Link to="/apuntes" className={BTN_PRIMARY}>{t('apuntes.backToSearch')}</Link>}
        />
      </main>
    )
  }

  const community = isCommunity(file)
  const author = authorName(file?.author, t)
  const meta = file
    ? [
        file.driveModifiedAt ? t('apuntes.file.updated', { date: formatDate(file.driveModifiedAt, i18n.language) }) : '',
        formatSize(file.sizeBytes),
      ].filter(Boolean).join(' · ')
    : ''

  return (
    <main id="main-content" tabIndex={-1} className="outline-none container-content py-section-mobile lg:py-section">
      <nav aria-label={t('apuntes.breadcrumbAria')} className="mb-4 font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted flex flex-wrap items-center gap-x-2">
        <Link to="/apuntes" className="hover:text-primary">{t('apuntes.title')}</Link>
        {file?.subjectId && (
          <>
            <span aria-hidden="true">/</span>
            <Link to={`/apuntes/${encodeURIComponent(file.subjectId)}`} className="hover:text-primary normal-case tracking-normal">
              {file.subjectName ?? file.subjectId}
            </Link>
          </>
        )}
      </nav>

      {error && (
        <div role="alert" className="flex flex-col items-start gap-3 py-6">
          <p className="font-body text-body-sm text-red-600 dark:text-red-400">{error}</p>
          <button type="button" onClick={() => setTick((n) => n + 1)} className="font-mono text-label uppercase tracking-widest text-primary hover:underline">
            {t('errors.retry')}
          </button>
        </div>
      )}

      {loading && !file && !error && (
        <div aria-busy="true" aria-hidden="true" className="flex flex-col gap-4">
          <div className="h-10 w-2/3 rounded-sm skeleton" />
          <div className="h-4 w-48 rounded-sm skeleton" />
          <div className="h-[60vh] rounded-card skeleton" />
        </div>
      )}

      {file && (
        <article>
          <header className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 pb-6 mb-6 border-b border-border dark:border-night-border">
            <div className="min-w-0">
              <div className="flex items-center gap-2 font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
                <KindIcon kind={file.kind} size={16} />
                <span>{t(`apuntes.kind.${file.kind}`, { defaultValue: file.kind })}</span>
                <YearBadge year={file.academicYear} source={file.academicYearSource} className="normal-case tracking-normal" />
                {file.path && <span className="normal-case tracking-normal truncate">· {file.path}</span>}
              </div>
              <h1 className="font-display font-bold text-h3 lg:text-h2 text-ink-primary dark:text-night-text mt-2 break-words">
                {file.name}
              </h1>
              <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted mt-2">
                {community
                  ? <><CommunityBadge year={file.academicYear} className="align-middle" />{meta && ` · ${meta}`}</>
                  : <>{t('apuntes.file.by', { author })}{meta && ` · ${meta}`}</>}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 flex-shrink-0">
              {file.hasPdf && !file.exportBlocked && (
                <a href={fileDownloadUrl(file.id, 'pdf', 'attachment')} className={BTN_OUTLINE}>
                  {t('apuntes.file.downloadPdf')}
                </a>
              )}
              {file.hasOriginal && !file.exportBlocked && (
                <a href={fileDownloadUrl(file.id, 'original', 'attachment')} className={BTN_OUTLINE}>
                  {t('apuntes.file.downloadOriginal')}
                </a>
              )}
              {safeHttpUrl(file.driveUrl) && (
                <a href={safeHttpUrl(file.driveUrl)!} target="_blank" rel="noopener noreferrer" className={BTN_OUTLINE}>
                  {t('apuntes.viewer.openInDrive')}
                </a>
              )}
              <button
                type="button"
                onClick={() => setReporting(true)}
                disabled={file.reportedByMe}
                title={file.reportedByMe ? t('apuntes.file.alreadyReported') : undefined}
                className="inline-flex items-center min-h-[40px] px-3 font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted hover:text-red-600 dark:hover:text-red-400 disabled:opacity-60 disabled:hover:text-ink-secondary"
              >
                {file.reportedByMe ? t('apuntes.file.alreadyReported') : t('apuntes.file.report')}
              </button>
            </div>
          </header>

          {notice && <Notice className="mb-6" onDismiss={() => setNotice(null)}>{notice}</Notice>}

          <FileViewer file={file} html={html} />
        </article>
      )}

      {reporting && file && (
        <ReportDialog
          fileId={file.id}
          fileName={file.name}
          onClose={() => setReporting(false)}
          onReported={() => {
            setReporting(false)
            setFile((f) => f && { ...f, reportedByMe: true })
            setNotice(t('apuntes.report.thanks'))
          }}
        />
      )}
    </main>
  )
}
