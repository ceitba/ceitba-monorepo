import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { deleteArticle } from '../../api/articles'
import { ConfirmDialog } from '@/components/ui'
import type { Article } from '../../types'
import { useQueueOptional } from '@/pages/manage/review/queueContext'

// Deleting an article can't be undone, so it always asks first; a failure
// stays inside the dialog.
export default function DeleteArticleDialog({
  article,
  onDeleted,
  onCancel,
}: {
  article: Article
  onDeleted: (article: Article) => void
  onCancel: () => void
}) {
  const queue = useQueueOptional()
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function handleConfirm() {
    setBusy(true)
    setError('')
    try {
      await deleteArticle(article.id)
      queue?.reloadSource('articles')
      onDeleted(article)
    } catch (err) {
      console.error('newsletter: delete article', err)
      setError(t('admin.articles.deleteError'))
      setBusy(false)
    }
  }

  return (
    <ConfirmDialog
      title={t('admin.articles.deleteDialog.title')}
      body={t('admin.articles.deleteDialog.body', { title: article.title })}
      confirmLabel={t('admin.articles.deleteDialog.confirm')}
      busy={busy}
      error={error || undefined}
      onConfirm={handleConfirm}
      onCancel={onCancel}
    />
  )
}
