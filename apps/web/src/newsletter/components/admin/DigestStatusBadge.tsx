import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui'
import { statusTone } from './statusTone'
import type { DigestStatus } from '../../types'

export default function DigestStatusBadge({ status }: { status: DigestStatus }) {
  const { t } = useTranslation()
  return (
    <Badge tone={statusTone(status)} className="gap-1.5">
      {status === 'sending' && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" aria-hidden="true" />}
      {t(`admin.digests.status.${status}`)}
    </Badge>
  )
}
