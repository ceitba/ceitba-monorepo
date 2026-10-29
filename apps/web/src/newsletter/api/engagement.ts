// Comments and polls of an article (apps/api/docs/NEWSLETTER-ENGAGEMENT.md).
import { apiGet, apiSend } from '@/api/client'

const enc = encodeURIComponent
const comments = (articleId: string, rest = '') => `/articles/${enc(articleId)}/comments${rest}`
const polls = (articleId: string, rest = '') => `/articles/${enc(articleId)}/polls${rest}`

// ── Comments ────────────────────────────────────────────────────────────────

export interface Comment {
  id: string
  parentId: string | null
  authorName: string | null
  authorAvatarUrl: string | null
  authorRole: 'author' | null
  body: string
  createdAt: string
  likes: number
  likedByMe: boolean
  mine: boolean
  pinned: boolean
  deleted: boolean
  hidden: boolean
  replies: Comment[]
}

export interface CommentThread {
  enabled: boolean
  canModerate: boolean
  total: number
  comments: Comment[]
}

export type CommentSort = 'top' | 'new'

export const COMMENT_MAX = 1000

export function fetchComments(articleId: string, sort: CommentSort): Promise<CommentThread> {
  return apiGet(comments(articleId, `?sort=${sort}`))
}

export function postComment(articleId: string, body: string, parentId: string | null = null): Promise<Comment> {
  return apiSend('POST', comments(articleId), { body, parentId })
}

export function deleteComment(articleId: string, commentId: string): Promise<void> {
  return apiSend('DELETE', comments(articleId, `/${commentId}`))
}

export function setCommentLike(articleId: string, commentId: string, liked: boolean): Promise<{ likes: number; likedByMe: boolean }> {
  return apiSend(liked ? 'PUT' : 'DELETE', comments(articleId, `/${commentId}/like`))
}

export function reportComment(articleId: string, commentId: string, reason: string | null): Promise<void> {
  return apiSend('PUT', comments(articleId, `/${commentId}/report`), { reason })
}

export function pinComment(articleId: string, commentId: string, pinned: boolean): Promise<Comment> {
  return apiSend('PUT', comments(articleId, `/${commentId}/pin`), { pinned })
}

export function restoreComment(articleId: string, commentId: string): Promise<Comment> {
  return apiSend('POST', comments(articleId, `/${commentId}/restore`))
}

export function setCommentsEnabled(articleId: string, enabled: boolean): Promise<{ enabled: boolean }> {
  return apiSend('PUT', comments(articleId, '/settings'), { enabled })
}

// ── Polls ───────────────────────────────────────────────────────────────────

export type ResultsVisibility = 'after_vote' | 'after_close'

export interface PollOption { id: string; label: string; votes: number | null }

export interface Poll {
  id: string
  question: string
  options: PollOption[]
  resultsVisibility: ResultsVisibility
  closesAt: string | null
  closed: boolean
  totalVotes: number | null
  myVote: string | null
  resultsVisible: boolean
  canEdit: boolean
}

export interface PollInput {
  question: string
  options: string[]
  resultsVisibility: ResultsVisibility
  closesAt: string | null
}

export const POLL_MIN_OPTIONS = 2
export const POLL_MAX_OPTIONS = 6

export function fetchPolls(articleId: string): Promise<Poll[]> {
  return apiGet(polls(articleId))
}

export function fetchPoll(articleId: string, pollId: string): Promise<Poll> {
  return apiGet(polls(articleId, `/${enc(pollId)}`))
}

export function createPoll(articleId: string, input: PollInput): Promise<Poll> {
  return apiSend('POST', polls(articleId), input)
}

export function updatePoll(articleId: string, pollId: string, patch: Partial<PollInput> & { close?: boolean; reopen?: boolean }): Promise<Poll> {
  return apiSend('PATCH', polls(articleId, `/${pollId}`), patch)
}

export function deletePoll(articleId: string, pollId: string): Promise<void> {
  return apiSend('DELETE', polls(articleId, `/${pollId}`))
}

export function votePoll(articleId: string, pollId: string, optionId: string | null): Promise<Poll> {
  return optionId === null
    ? apiSend('DELETE', polls(articleId, `/${pollId}/vote`))
    : apiSend('PUT', polls(articleId, `/${pollId}/vote`), { optionId })
}

// A ```poll fence holds the poll id (and nothing else).
export const POLL_FENCE_LANGUAGE = 'poll'
export const pollFence = (pollId: string) => `\`\`\`${POLL_FENCE_LANGUAGE}\n${pollId}\n\`\`\``
