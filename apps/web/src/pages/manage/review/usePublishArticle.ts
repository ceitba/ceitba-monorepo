import { useCallback } from 'react'
import { toast } from '../../../components/ui'
import { updateArticle } from '../../../newsletter/api/articles'
import type { Article, ArticleStatus, IsoDate } from '../../../newsletter/types'
import { todayISO } from '../../../newsletter/utils/dates'
import { useQueueOptional } from './queueContext'

// What publishing changed, so Deshacer can put it back exactly: the previous
// status and the previous date (null when publishing filled one in, which
// undo then clears; otherwise a later publish would go out back-dated).
interface PublishSnapshot {
  id: string
  status: ArticleStatus
  date: IsoDate | null
}

async function publish(article: Article): Promise<PublishSnapshot> {
  const snapshot = { id: article.id, status: article.status, date: article.date ?? null }
  // An article sent without a date gets today's.
  await updateArticle(article.id, { status: 'published', ...(article.date ? {} : { date: todayISO() }) })
  return snapshot
}

function undo(s: PublishSnapshot): Promise<Article> {
  return updateArticle(s.id, { status: s.status, date: s.date })
}

export interface PublishMessages {
  published: string
  undo: string
  undoFailed: (e: unknown) => string
}

// The one publish used by Para revisar and the newsletter's Revisión tab:
// publishes, drops the article from the shared review queue (so the rail and
// the tab counts agree), and toasts with a Deshacer that restores status and
// date. Throws the API error so the caller can tell a conflict (409: someone
// already handled it) from a real failure.
export function usePublishArticle() {
  const queue = useQueueOptional()
  return useCallback(async (article: Article, msgs: PublishMessages, onUndone?: () => void) => {
    const snapshot = await publish(article)
    queue?.remove('articles', article.id)
    toast.success(msgs.published, {
      label: msgs.undo,
      onClick: () => {
        undo(snapshot)
          .then(() => { queue?.reloadSource('articles'); onUndone?.() })
          .catch((e: unknown) => toast.error(msgs.undoFailed(e)))
      },
    })
  }, [queue])
}
