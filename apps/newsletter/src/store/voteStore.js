/**
 * Vote store.
 *
 * Aggregate counts: localStorage key 'itbanews_votes_v1'
 *   { [articleId]: { up: number, down: number } }
 *
 * Per-session user vote: sessionStorage key 'itbanews_my_votes'
 *   { [articleId]: 'up' | 'down' }
 *
 * On the real API this becomes:
 *   POST /articles/:id/votes  { type: 'up' | 'down' }
 *   DELETE /articles/:id/votes  (retract)
 * Counts are returned only in authenticated admin responses.
 */

const VOTES_KEY    = 'itbanews_votes_v1'
const MY_VOTES_KEY = 'itbanews_my_votes'

function loadVotes() {
  try {
    const raw = localStorage.getItem(VOTES_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveVotes(votes) {
  try { localStorage.setItem(VOTES_KEY, JSON.stringify(votes)) } catch {}
}

function loadMyVotes() {
  try {
    const raw = sessionStorage.getItem(MY_VOTES_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveMyVotes(mv) {
  try { sessionStorage.setItem(MY_VOTES_KEY, JSON.stringify(mv)) } catch {}
}

/**
 * Cast or retract a vote. Returns the new state for the article.
 * @returns {{ up: number, down: number, myVote: 'up'|'down'|null }}
 */
export function castVote(articleId, type) {
  const votes   = loadVotes()
  const myVotes = loadMyVotes()
  const current = votes[articleId] ?? { up: 0, down: 0 }
  const prev    = myVotes[articleId] ?? null

  if (prev === type) {
    // Retract
    current[type] = Math.max(0, current[type] - 1)
    myVotes[articleId] = null
  } else {
    if (prev) current[prev] = Math.max(0, current[prev] - 1)  // undo old vote
    current[type] = current[type] + 1
    myVotes[articleId] = type
  }

  votes[articleId] = current
  saveVotes(votes)
  saveMyVotes(myVotes)

  return { ...current, myVote: myVotes[articleId] ?? null }
}

export function getVotesForArticle(articleId) {
  const votes   = loadVotes()
  const myVotes = loadMyVotes()
  const counts  = votes[articleId] ?? { up: 0, down: 0 }
  return { ...counts, myVote: myVotes[articleId] ?? null }
}

export function getAllVotes() {
  return loadVotes()   // { articleId: { up, down } }
}
