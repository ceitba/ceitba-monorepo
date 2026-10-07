import { createContext, useContext } from 'react'
import type { ReviewQueue } from './useReviewQueue'

// The review queue is loaded once by the Administración shell: the rail
// shows its counts and "Para revisar" lists it, from the same data.
export const ReviewQueueContext = createContext<ReviewQueue | null>(null)

export function useQueue(): ReviewQueue {
  const q = useContext(ReviewQueueContext)
  if (!q) throw new Error('useQueue outside ReviewQueueContext')
  return q
}
