import { createContext, useContext } from 'react'
import type { ReviewQueue } from './useReviewQueue'

// The review queue lives in the Administración shell: the rail shows its
// counts, "Para revisar" lists it, and the areas report their decisions to
// it (reloadSource/remove) so everything shows the same numbers.
export const ReviewQueueContext = createContext<ReviewQueue | null>(null)

export function useQueue(): ReviewQueue {
  const q = useContext(ReviewQueueContext)
  if (!q) throw new Error('useQueue outside ReviewQueueContext')
  return q
}

// For components that also render outside Administración (the article
// editor, shared newsletter dialogs): null there.
export function useQueueOptional(): ReviewQueue | null {
  return useContext(ReviewQueueContext)
}
