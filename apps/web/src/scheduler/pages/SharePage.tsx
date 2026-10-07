import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  type ShareSession,
  getShareSession,
  joinShareSession,
  leaveShareSession,
  deleteShareSession,
} from '../api/share'
import { listSavedSchedules, type SavedSchedule } from '../api/schedules'
import { ApiError } from '@/api/client'
import { usePlanCatalogs } from '../hooks/usePlanCatalogs'
import { useAuth } from '@/hooks/useAuth'
import { useBeginSignIn } from '../context/signInContext'
import HeatmapGrid from '../components/HeatmapGrid'
import ScheduleGridSkeleton from '../components/ScheduleGridSkeleton'
import SchedulerHeader from '../components/SchedulerHeader'
import { buildHeatmap } from '../services/heatmap'
import { errorMessageKey } from '../services/apiErrors'
import { careerPlanLabel } from '../utils/careerLabel'
import { SCHEDULER_BASE } from '../paths'
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingRegion,
  Modal,
  Skeleton,
  buttonClass,
  toast,
} from '@/components/ui'

// How often an open share page refetches the session so new participants
// show up without a reload. Paused while the tab is hidden.
const SHARE_POLL_INTERVAL_MS = 20_000

export default function SharePage() {
  const beginSignIn = useBeginSignIn()
  const { t } = useTranslation()
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { profile } = useAuth()

  const [session, setSession] = useState<ShareSession | null>(null)
  // Token (and attempt) whose initial load has finished; while it differs
  // the page shows its loading state.
  const [attempt, setAttempt] = useState(0)
  const loadKey = `${token}#${attempt}`
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const loading = loadedKey !== loadKey
  // i18n key of why the session couldn't be loaded, or null.
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showJoin, setShowJoin] = useState(false)
  const [joinError, setJoinError] = useState<string | null>(null)
  // null until loaded (the join dialog waits for it).
  const [savedList, setSavedList] = useState<SavedSchedule[] | null>(null)
  const [savedListFailed, setSavedListFailed] = useState(false)
  const [savedListAttempt, setSavedListAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState<{ busy: boolean; error: string | null } | null>(null)
  // Bumped by every fetch and by join/leave, so a slower, older response
  // never overwrites a newer session.
  const sessionSeq = useRef(0)

  // Initial load plus polling while the page is visible. Background
  // refreshes don't touch `loading`, and an unchanged session keeps its
  // identity so nothing re-renders.
  useEffect(() => {
    if (!token) return
    let cancelled = false
    let interval: number | undefined

    const refresh = async (initial: boolean) => {
      const seq = ++sessionSeq.current
      try {
        const next = await getShareSession(token)
        if (cancelled || seq !== sessionSeq.current) return
        setSession((prev) => (prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
        if (initial) setLoadError(null)
      } catch (e) {
        if (cancelled || seq !== sessionSeq.current) return
        // Background failures are transient unless the session is gone.
        const gone = e instanceof ApiError && e.status === 404
        if (initial || gone) {
          if (!initial) setSession(null)
          setLoadError(gone ? 'share.notFound' : errorMessageKey(e, 'share.loadFailed'))
        }
      } finally {
        if (initial && !cancelled) setLoadedKey(loadKey)
      }
    }

    const start = () => {
      if (interval === undefined) interval = window.setInterval(() => void refresh(false), SHARE_POLL_INTERVAL_MS)
    }
    const stop = () => {
      if (interval !== undefined) { window.clearInterval(interval); interval = undefined }
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') { void refresh(false); start() }
      else stop()
    }

    void refresh(true)
    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      cancelled = true
      stop()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [token, loadKey])

  // Subject catalog for every distinct plan present in the session so the
  // heatmap can resolve commission times. Plans missing from the map
  // degrade gracefully (no course slots, just blocked time).
  const sessionPlans = useMemo(
    () => (session?.participants ?? []).map((p) => p.plan).filter((p): p is string => !!p),
    [session],
  )
  const { subjectsByPlan, failedPlans } = usePlanCatalogs(sessionPlans)
  const catalogError = failedPlans.length > 0 ? t('share.catalogLoadFailed', { plans: failedPlans.join(', ') }) : null

  useEffect(() => {
    if (!profile) return
    let cancelled = false
    listSavedSchedules()
      .then((list) => { if (!cancelled) { setSavedList(list); setSavedListFailed(false) } })
      .catch((e) => {
        console.error(e)
        // A failed load must not look like "you have no saved schedules".
        if (!cancelled) setSavedListFailed(true)
      })
    return () => { cancelled = true }
  }, [profile, savedListAttempt])

  const heatmap = useMemo(
    () => (session ? buildHeatmap(session.participants, subjectsByPlan) : null),
    [session, subjectsByPlan],
  )

  const isParticipant = !!profile && !!session?.participants.some((p) => p.userId === profile.id)
  const isCreator = !!profile && !!session && session.participants.some((p) => p.isCreator && p.userId === profile.id)

  async function handleJoin(savedScheduleId: string) {
    if (!token) return
    setBusy(true)
    setJoinError(null)
    try {
      const updated = await joinShareSession(token, { savedScheduleId })
      sessionSeq.current++
      setSession(updated)
      setShowJoin(false)
      toast.success(t('share.joined'))
    } catch (e) {
      setJoinError(t(errorMessageKey(e, 'share.errors.joinFailed')))
    } finally {
      setBusy(false)
    }
  }

  // Reversible (they can add their schedule again), so no confirmation.
  async function handleLeave() {
    if (!token) return
    setBusy(true)
    try {
      await leaveShareSession(token)
      const refreshed = await getShareSession(token)
      sessionSeq.current++
      setSession(refreshed)
      toast.info(t('share.left'))
    } catch (e) {
      toast.error(t(errorMessageKey(e, 'share.errors.leaveFailed')))
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (!token) return
    setDeleting({ busy: true, error: null })
    try {
      await deleteShareSession(token)
      toast.success(t('share.deleted'))
      navigate(SCHEDULER_BASE, { replace: true })
    } catch (e) {
      setDeleting({ busy: false, error: t(errorMessageKey(e, 'share.errors.deleteFailed')) })
    }
  }

  async function copyLink() {
    const url = window.location.href
    try {
      await navigator.clipboard.writeText(url)
      toast.success(t('save.linkCopied'))
    } catch {
      toast.error(t('save.linkCopyFailed', { url }))
    }
  }

  return (
    <div className="flex flex-col bg-surface dark:bg-night-bg">
      <SchedulerHeader />

      <main id="main-content" tabIndex={-1} className="flex-1 container-content py-section-mobile lg:py-section outline-none">
        {loading ? (
          <LoadingRegion className="flex flex-col gap-3">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-9 w-2/3 max-w-md" />
            <Skeleton className="h-4 w-48 mb-4" />
            <div className="bg-white dark:bg-night-surface rounded-card border border-border dark:border-night-border px-4 py-4">
              <ScheduleGridSkeleton />
            </div>
          </LoadingRegion>
        ) : loadError && !session ? (
          <ErrorState
            message={t(loadError)}
            onRetry={() => setAttempt((n) => n + 1)}
            backTo={SCHEDULER_BASE}
            backLabel={t('share.backToScheduler')}
          />
        ) : session && heatmap ? (
          <>
            <header className="mb-6">
              <p className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
                {t('share.heatmap.label')}
              </p>
              <h1 className="font-display font-bold text-h2 text-ink-primary dark:text-night-text">
                {session.name ?? t('share.untitledSession')}
              </h1>
              <p className="font-body text-body text-ink-secondary dark:text-night-muted mt-1">
                {t('share.participantCount', { count: session.participants.length })}
                {session.creatorDisplayName && ` · ${t('share.createdBy', { name: session.creatorDisplayName })}`}
              </p>
            </header>

            {loadError && <Alert tone="error" className="mb-4">{t(loadError)}</Alert>}
            {catalogError && <Alert tone="warning" className="mb-4">{catalogError}</Alert>}

            <div className="flex flex-wrap gap-2 mb-6">
              {!profile && <Button onClick={beginSignIn}>{t('share.signInToJoin')}</Button>}
              {profile && !isParticipant && (
                <Button onClick={() => { setJoinError(null); setShowJoin(true) }}>{t('share.addMySchedule')}</Button>
              )}
              <Button variant="outline" onClick={copyLink}>{t('share.copyLink')}</Button>
              {profile && isParticipant && !isCreator && (
                <Button variant="ghost" onClick={handleLeave} loading={busy}>{t('share.leave')}</Button>
              )}
              {isCreator && (
                <Button variant="dangerGhost" onClick={() => setDeleting({ busy: false, error: null })}>
                  {t('share.deleteSession')}
                </Button>
              )}
            </div>

            <section className="bg-white dark:bg-night-surface rounded-card border border-border dark:border-night-border px-4 py-4">
              <HeatmapGrid model={heatmap} />
            </section>

            <section className="mt-6">
              <h2 className="font-body font-semibold text-body text-ink-primary dark:text-night-text mb-2">
                {t('share.participantsHeading')}
              </h2>
              <ul className="flex flex-wrap gap-2">
                {session.participants.map((p) => (
                  <li
                    key={p.userId}
                    className="inline-flex flex-wrap items-center gap-2 px-3 py-1.5 rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface font-body text-body-sm text-ink-primary dark:text-night-text"
                  >
                    {p.displayName}
                    {p.isCreator && <Badge tone="info">{t('share.creatorTag')}</Badge>}
                    {!p.payload && <Badge tone="neutral">{t('share.scheduleRemoved')}</Badge>}
                  </li>
                ))}
              </ul>
            </section>
          </>
        ) : null}
      </main>

      {showJoin && (
        <JoinDialog
          savedList={savedList}
          loadFailed={savedListFailed}
          onRetryLoad={() => { setSavedListFailed(false); setSavedList(null); setSavedListAttempt((n) => n + 1) }}
          busy={busy}
          error={joinError}
          onJoin={handleJoin}
          onClose={() => setShowJoin(false)}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={t('share.confirmDeleteTitle')}
          body={t('share.confirmDelete')}
          confirmLabel={t('share.confirmDeleteAction')}
          busy={deleting.busy}
          error={deleting.error}
          onConfirm={handleDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  )
}

function JoinDialog({
  savedList,
  loadFailed,
  onRetryLoad,
  busy,
  error,
  onJoin,
  onClose,
}: {
  savedList: SavedSchedule[] | null
  loadFailed: boolean
  onRetryLoad: () => void
  busy: boolean
  error: string | null
  onJoin: (id: string) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [picked, setPicked] = useState<string | null>(null)
  const selected = picked ?? savedList?.[0]?.id ?? null
  const empty = !loadFailed && savedList !== null && savedList.length === 0

  return (
    <Modal
      title={t('share.join.title')}
      onClose={onClose}
      busy={busy}
      footer={
        empty || loadFailed ? (
          <Button variant="ghost" onClick={onClose}>{t('ui.close')}</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>{t('ui.cancel')}</Button>
            <Button onClick={() => selected && onJoin(selected)} disabled={!selected} loading={busy}>
              {t('share.join.confirm')}
            </Button>
          </>
        )
      }
    >
      {loadFailed ? (
        <ErrorState compact message={t('share.join.loadFailed')} onRetry={onRetryLoad} />
      ) : savedList === null ? (
        <LoadingRegion className="flex flex-col gap-2">
          <Skeleton className="h-14 rounded-card" />
          <Skeleton className="h-14 rounded-card" />
        </LoadingRegion>
      ) : empty ? (
        <EmptyState
          compact
          title={t('share.join.noSavedTitle')}
          body={t('share.join.noSaved')}
          action={<Link to={SCHEDULER_BASE} className={buttonClass()}>{t('share.join.makeOne')}</Link>}
        />
      ) : (
        <>
          <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">
            {t('share.join.hint')}
          </p>
          <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
            {savedList.map((s) => {
              const checked = selected === s.id
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={checked}
                  onClick={() => setPicked(s.id)}
                  className={`w-full min-h-[44px] px-3 py-2 rounded-card border text-left transition-colors ${
                    checked
                      ? 'border-primary bg-primary text-white dark:border-primary-400 dark:bg-primary-700'
                      : 'border-border dark:border-night-border bg-surface dark:bg-night-bg text-ink-primary dark:text-night-text hover:border-primary'
                  }`}
                >
                  <span className="block font-body font-semibold text-body-sm">{s.name}</span>
                  <span className="block font-mono text-label uppercase tracking-widest opacity-80">
                    {careerPlanLabel(t, s.careerId, s.plan)}
                  </span>
                </button>
              )
            })}
          </div>
          {error && <Alert tone="error">{error}</Alert>}
        </>
      )}
    </Modal>
  )
}
