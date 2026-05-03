import { apiRequest } from '../api/client'

const MY_VOTES_KEY = 'itbanews_my_votes'

function loadMyVotes() {
  try { return JSON.parse(sessionStorage.getItem(MY_VOTES_KEY) ?? '{}') } catch { return {} }
}

function saveMyVotes(mv) {
  try { sessionStorage.setItem(MY_VOTES_KEY, JSON.stringify(mv)) } catch {}
}

export async function getVotesForArticle(articleId) {
  try {
    const res = await apiRequest('GET', `/articles/${articleId}/votes`)
    if (!res || !res.ok) return { up: 0, down: 0, myVote: null }
    const counts = await res.json()
    const myVotes = loadMyVotes()
    return { ...counts, myVote: myVotes[articleId] ?? null }
  } catch {
    return { up: 0, down: 0, myVote: null }
  }
}

// Returns optimistic state immediately; updates counts when API responds.
// Callers should await and re-render with the final counts.
export async function castVote(articleId, type) {
  const myVotes = loadMyVotes()
  const prev = myVotes[articleId] ?? null

  myVotes[articleId] = prev === type ? null : type
  saveMyVotes(myVotes)

  try {
    const res = await apiRequest('POST', `/articles/${articleId}/votes`, { type })
    if (res && res.ok) {
      const counts = await res.json()
      return { ...counts, myVote: myVotes[articleId] ?? null }
    }
  } catch {}

  return { up: 0, down: 0, myVote: myVotes[articleId] ?? null }
}
