import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError } from '../../../api/client'
import { fetchStaffCorrections, type StaffCorrection } from '../../../api/corrections'
import { fetchStaffFiles, fetchStaffSources, type StaffFile, type StaffSource } from '../../../api/drive'
import { fetchRuns, isBlockedStatus, type KbRun } from '../../../api/kbAdmin'
import { fetchAllArticles } from '../../../newsletter/api/articles'
import type { Article } from '../../../newsletter/types'

// Everything that waits on a staff decision, gathered from the endpoints the
// areas already use. Each source loads on its own, so one that fails (or
// doesn't exist on this API build) never blanks the others.

export type SourceId = 'articles' | 'corrections' | 'sources' | 'needsReview' | 'reported' | 'wiki'
export type SourceStatus = 'loading' | 'ok' | 'error' | 'unavailable'

// The queue's four kinds, as the filter and the rail group them.
export type QueueKind = 'articles' | 'corrections' | 'apuntes' | 'wiki'

// How many rows of each paged source the queue shows; the area has the rest.
export const QUEUE_PAGE = 50

// revalidate() skips the reload when the queue loaded this recently.
const REVALIDATE_AFTER_MS = 15_000

export interface QueueData {
  articles: Article[]
  corrections: StaffCorrection[]
  correctionsTotal: number
  sources: StaffSource[]
  sourcesTotal: number
  needsReview: StaffFile[]
  needsReviewTotal: number
  reported: StaffFile[]
  reportedTotal: number
  // Runs that need a staff decision or look: waiting for cost approval, or
  // the latest real run when it failed.
  wikiRuns: KbRun[]
}

const EMPTY: QueueData = {
  articles: [],
  corrections: [],
  correctionsTotal: 0,
  sources: [],
  sourcesTotal: 0,
  needsReview: [],
  needsReviewTotal: 0,
  reported: [],
  reportedTotal: 0,
  wikiRuns: [],
}

const ALL_SOURCES: SourceId[] = ['articles', 'corrections', 'sources', 'needsReview', 'reported', 'wiki']

// A feature that's off (or missing on this API build) answers 404/403/503:
// that's "nothing to review", not an error to show.
function isUnavailable(e: unknown): boolean {
  return e instanceof ApiError && [403, 404, 501, 503].includes(e.status)
}

function wikiAttention(runs: KbRun[]): KbRun[] {
  const blocked = runs.filter((r) => isBlockedStatus(r.status))
  const latest = runs.find((r) => !r.dryRun && !r.simulated && r.finishedAt)
  const failed = latest && /FAIL/i.test(latest.status) ? [latest] : []
  return [...blocked, ...failed.filter((r) => !blocked.includes(r))]
}

export interface ReviewQueue {
  data: QueueData
  status: Record<SourceId, SourceStatus>
  counts: Record<QueueKind, number> & { total: number }
  // True until every source has answered once.
  loading: boolean
  reload: () => void
  reloadSource: (id: SourceId) => void
  // Reloads everything unless it was loaded a moment ago (navigation and
  // window focus call it as a safety net for changes made elsewhere).
  revalidate: () => void
  // Drops a row right away after a decision (the next reload confirms it).
  remove: (source: SourceId, id: string) => void
}

export function useReviewQueue(): ReviewQueue {
  const [data, setData] = useState<QueueData>(EMPTY)
  const [status, setStatus] = useState<Record<SourceId, SourceStatus>>(
    () => Object.fromEntries(ALL_SOURCES.map((s) => [s, 'loading'])) as Record<SourceId, SourceStatus>,
  )
  // Per-source request counters: only the latest answer may write.
  const reqs = useRef<Record<string, number>>({})

  const load = useCallback((id: SourceId) => {
    const n = (reqs.current[id] ?? 0) + 1
    reqs.current[id] = n
    const settle = (patch: Partial<QueueData>, s: SourceStatus) => {
      if (reqs.current[id] !== n) return
      setData((d) => ({ ...d, ...patch }))
      setStatus((st) => ({ ...st, [id]: s }))
    }
    const fail = (e: unknown) => {
      if (reqs.current[id] !== n) return
      if (!isUnavailable(e)) console.error(`review queue: ${id}`, e)
      setStatus((st) => ({ ...st, [id]: isUnavailable(e) ? 'unavailable' : 'error' }))
    }

    switch (id) {
      case 'articles':
        fetchAllArticles({ status: 'pending_review' })
          .then((articles) => settle({ articles }, 'ok')).catch(fail)
        break
      case 'corrections':
        fetchStaffCorrections({ status: 'PENDING', limit: QUEUE_PAGE })
          .then((p) => settle({ corrections: p.data, correctionsTotal: p.meta.total }, 'ok')).catch(fail)
        break
      case 'sources':
        fetchStaffSources({ status: 'PENDING_REVIEW', limit: QUEUE_PAGE })
          .then((p) => settle({ sources: p.items, sourcesTotal: p.total }, 'ok')).catch(fail)
        break
      case 'needsReview':
        fetchStaffFiles({ publication: 'NEEDS_REVIEW', limit: QUEUE_PAGE })
          .then((p) => settle({ needsReview: p.items, needsReviewTotal: p.total }, 'ok')).catch(fail)
        break
      case 'reported':
        fetchStaffFiles({ publication: 'HIDDEN_REPORTED', limit: QUEUE_PAGE })
          .then((p) => settle({ reported: p.items, reportedTotal: p.total }, 'ok')).catch(fail)
        break
      case 'wiki':
        fetchRuns(10)
          .then((runs) => settle({ wikiRuns: wikiAttention(runs) }, 'ok')).catch(fail)
        break
    }
  }, [])

  const loadedAt = useRef(0)
  const reload = useCallback(() => { loadedAt.current = Date.now(); ALL_SOURCES.forEach(load) }, [load])
  const revalidate = useCallback(() => {
    if (Date.now() - loadedAt.current > REVALIDATE_AFTER_MS) reload()
  }, [reload])

  useEffect(() => { reload() }, [reload])

  // Another tab or staff member may have decided meanwhile.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') revalidate() }
    window.addEventListener('focus', revalidate)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', revalidate)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [revalidate])

  const remove = useCallback((source: SourceId, id: string) => {
    setData((d) => {
      switch (source) {
        case 'articles': return { ...d, articles: d.articles.filter((a) => a.id !== id) }
        case 'corrections': return { ...d, corrections: d.corrections.filter((c) => c.id !== id), correctionsTotal: Math.max(0, d.correctionsTotal - 1) }
        case 'sources': return { ...d, sources: d.sources.filter((s) => s.id !== id), sourcesTotal: Math.max(0, d.sourcesTotal - 1) }
        case 'needsReview': return { ...d, needsReview: d.needsReview.filter((f) => f.id !== id), needsReviewTotal: Math.max(0, d.needsReviewTotal - 1) }
        case 'reported': return { ...d, reported: d.reported.filter((f) => f.id !== id), reportedTotal: Math.max(0, d.reportedTotal - 1) }
        case 'wiki': return { ...d, wikiRuns: d.wikiRuns.filter((r) => r.id !== id) }
      }
    })
  }, [])

  const counts = useMemo(() => {
    const ok = (id: SourceId) => status[id] === 'ok'
    const articles = ok('articles') ? data.articles.length : 0
    const corrections = ok('corrections') ? data.correctionsTotal : 0
    const apuntes = (ok('sources') ? data.sourcesTotal : 0)
      + (ok('needsReview') ? data.needsReviewTotal : 0)
      + (ok('reported') ? data.reportedTotal : 0)
    const wiki = ok('wiki') ? data.wikiRuns.length : 0
    return { articles, corrections, apuntes, wiki, total: articles + corrections + apuntes + wiki }
  }, [data, status])

  const loading = ALL_SOURCES.some((s) => status[s] === 'loading')

  return { data, status, counts, loading, reload, reloadSource: load, revalidate, remove }
}
