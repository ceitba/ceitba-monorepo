import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui'
import { statusTone } from './statusTone'
import type { ArticleStatus } from '../../types'

// An article's status as a kit Badge. `null` = a new article never saved.
export default function ArticleStatusBadge({ status }: { status: ArticleStatus | null }) {
  const { t } = useTranslation()
  if (!status) return <Badge tone="neutral">{t('admin.articleForm.unsavedStatus')}</Badge>
  return <Badge tone={statusTone(status)}>{t(`admin.status.${status}`)}</Badge>
}
