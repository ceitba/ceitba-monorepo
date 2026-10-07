import { apiGet, apiSend, ApiError } from '@/api/client'
import type { VoteCounts, VoteType } from '../types'

// Counts plus the reader's own vote in this tab.
export interface VoteState extends VoteCounts {
  myVote: VoteType | null
}

// The API dedupes votes by a fingerprint (IP + User-Agent) and never tells
// us which way "we" voted, so the reader's own vote is remembered per tab.
const MY_VOTES_KEY = 'itbanews_my_votes'

function loadMyVotes(): Record<string, VoteType> {
  // Cast: the key is only ever written by saveMyVote below.
  try { return JSON.parse(sessionStorage.getItem(MY_VOTES_KEY) ?? '{}') as Record<string, VoteType> } catch { return {} }
}

function saveMyVote(articleId: string, vote: VoteType | null): void {
  const mv = loadMyVotes()
  if (vote) mv[articleId] = vote
  else delete mv[articleId]
  try { sessionStorage.setItem(MY_VOTES_KEY, JSON.stringify(mv)) } catch { /* storage unavailable (private mode, quota): keep the in-memory state */ }
}

const votesPath = (articleId: string): string => `/articles/${encodeURIComponent(articleId)}/votes`

export async function getVotesForArticle(articleId: string): Promise<VoteState> {
  const myVote = loadMyVotes()[articleId] ?? null
  try {
    const counts = await apiGet<VoteCounts>(votesPath(articleId))
    return { up: counts.up ?? 0, down: counts.down ?? 0, myVote }
  } catch {
    return { up: 0, down: 0, myVote }
  }
}

// Toggles the reader's vote: clicking the active button retracts it
// (DELETE), otherwise casts/switches it (POST). `current` is the state the
// caller is showing ({ up, down, myVote }); on failure it is returned
// unchanged so the UI reverts instead of resetting counts to 0.
export async function castVote(
  articleId: string,
  type: VoteType,
  current: VoteState | null | undefined,
): Promise<VoteState | null | undefined> {
  const prev = current?.myVote ?? null
  try {
    if (prev === type) {
      try {
        await apiSend<void>('DELETE', votesPath(articleId))
      } catch (err) {
        if (!(err instanceof ApiError) || err.status !== 404) throw err // 404 = server had no vote from us
      }
      saveMyVote(articleId, null)
      const counts = await apiGet<VoteCounts>(votesPath(articleId)).catch((): VoteCounts => ({
        up:   Math.max(0, (current?.up ?? 0) - (type === 'up' ? 1 : 0)),
        down: Math.max(0, (current?.down ?? 0) - (type === 'down' ? 1 : 0)),
      }))
      return { up: counts.up ?? 0, down: counts.down ?? 0, myVote: null }
    }
    const counts = await apiSend<VoteCounts | undefined>('POST', votesPath(articleId), { type })
    saveMyVote(articleId, type)
    return { up: counts?.up ?? 0, down: counts?.down ?? 0, myVote: type }
  } catch {
    return current
  }
}
