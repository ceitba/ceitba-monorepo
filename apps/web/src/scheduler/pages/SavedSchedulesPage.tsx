import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/hooks/useAuth'
import {
  deleteSavedSchedule,
  listSavedSchedules,
  updateSavedSchedule,
  MAX_SAVED_SCHEDULES,
  type SavedSchedule,
} from '../api/schedules'
import { createShareSession } from '../api/share'
import { careerPlanLabel } from '../utils/careerLabel'
import { errorMessageKey } from '../services/apiErrors'
import { SchedulerBackLink } from '../components/SchedulerHeader'
import Checkbox from '../components/Checkbox'
import { SCHEDULER_BASE, careerPath, schedulerPath } from '../paths'
import {
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  SkeletonCards,
  buttonClass,
  inputClass,
  toast,
} from '@/components/ui'

const LIST_SKELETON = <SkeletonCards count={3} className="flex flex-col gap-3" cardClassName="h-28 sm:h-20" />

// The user's saved schedules with open (into CareerPage), share, rename,
// delete and compare. The actual restoration of selectedCourses / scheduler
// options / blocked times happens on CareerPage by reading the
// "savedSchedule" piece of router state we put here.
export default function SavedSchedulesPage() {
  const { t, i18n } = useTranslation()
  const { profile, loading } = useAuth()
  const navigate = useNavigate()
  // null until the first response; failed when it didn't load.
  const [list, setList] = useState<SavedSchedule[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [comparing, setComparing] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState<{ schedule: SavedSchedule; busy: boolean; error: string | null } | null>(null)

  useEffect(() => {
    if (!profile) return
    let ignore = false
    listSavedSchedules()
      .then((l) => { if (!ignore) setList(l) })
      .catch((e) => {
        if (ignore) return
        console.error(e)
        setLoadFailed(true)
      })
    return () => { ignore = true }
  }, [profile, attempt])

  const retry = () => {
    setLoadFailed(false)
    setList(null)
    setAttempt((n) => n + 1)
  }

  if (!loading && !profile) return <Navigate to={SCHEDULER_BASE} replace />

  function open(s: SavedSchedule) {
    if (!s.careerId || !s.plan) {
      toast.error(t('saved.openMissingContext'))
      return
    }
    navigate(careerPath(s.careerId, s.plan), { state: { savedSchedule: s } })
  }

  async function confirmDelete() {
    if (!deleting) return
    const { schedule } = deleting
    setDeleting({ schedule, busy: true, error: null })
    try {
      await deleteSavedSchedule(schedule.id)
      setList((prev) => prev && prev.filter((s) => s.id !== schedule.id))
      setComparing((prev) => {
        const next = new Set(prev)
        next.delete(schedule.id)
        return next
      })
      setDeleting(null)
      toast.success(t('saved.deleted', { name: schedule.name }))
    } catch (e) {
      setDeleting({ schedule, busy: false, error: t(errorMessageKey(e, 'saved.errors.deleteFailed')) })
    }
  }

  async function share(s: SavedSchedule) {
    setBusyId(s.id)
    try {
      const session = await createShareSession({ savedScheduleId: s.id, name: s.name })
      navigate(schedulerPath(`/share/${session.token}`))
    } catch (e) {
      toast.error(t(errorMessageKey(e, 'saved.errors.shareFailed')))
    } finally {
      setBusyId(null)
    }
  }

  async function commitRename() {
    if (!renaming || !list) return
    const next = renaming.name.trim()
    if (!next) return
    const target = list.find((s) => s.id === renaming.id)
    if (!target) return
    setBusyId(renaming.id)
    try {
      const updated = await updateSavedSchedule(renaming.id, {
        name: next,
        careerId: target.careerId,
        plan: target.plan,
        payload: target.payload,
      })
      setList((prev) => prev && prev.map((s) => (s.id === renaming.id ? updated : s)))
      setRenaming(null)
    } catch (e) {
      toast.error(t(errorMessageKey(e, 'saved.errors.renameFailed')))
    } finally {
      setBusyId(null)
    }
  }

  function toggleComparing(id: string) {
    setComparing((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function startCompare() {
    const ids = Array.from(comparing)
    if (ids.length < 2) return
    navigate(schedulerPath(`/compare?ids=${ids.join(',')}`))
  }

  const canCompare = comparing.size >= 2

  return (
    <div className="flex flex-col bg-surface dark:bg-night-bg">
      <main id="main-content" tabIndex={-1} className="flex-1 container-content py-section-mobile lg:py-section outline-hidden">
        <SchedulerBackLink />
        <header className="mb-6 flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-56">
            <h1 className="font-display font-bold text-h2 text-ink-primary dark:text-night-text">{t('saved.pageTitle')}</h1>
            {list && (
              <p className="font-body text-body text-ink-secondary dark:text-night-muted mt-1">
                {t('saved.usage', { count: list.length, max: MAX_SAVED_SCHEDULES })}
              </p>
            )}
          </div>
          {list && list.length >= 2 && (
            <div className="flex flex-col items-start sm:items-end gap-1">
              <Button onClick={startCompare} disabled={!canCompare}>
                {canCompare ? t('saved.compareSelected', { count: comparing.size }) : t('saved.compare')}
              </Button>
              {!canCompare && (
                <p className="font-body text-label text-ink-secondary dark:text-night-muted">{t('saved.compareHint')}</p>
              )}
            </div>
          )}
        </header>

        {loadFailed ? (
          <ErrorState message={t('saved.errors.loadFailed')} onRetry={retry} backTo={SCHEDULER_BASE} backLabel={t('saved.backToScheduler')} />
        ) : loading || list === null ? (
          LIST_SKELETON
        ) : list.length === 0 ? (
          <EmptyState
            title={t('saved.emptyTitle')}
            body={t('saved.emptyBody')}
            action={<Link to={SCHEDULER_BASE} className={buttonClass()}>{t('saved.emptyAction')}</Link>}
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {list.map((s) => {
              const busy = busyId === s.id
              const isRenaming = renaming?.id === s.id
              return (
                <li key={s.id} className="p-4 rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface flex flex-col md:flex-row md:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    {isRenaming ? (
                      <input
                        autoFocus
                        value={renaming.name}
                        maxLength={120}
                        aria-label={t('saved.nameLabel')}
                        onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
                        onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(null) }}
                        className={inputClass()}
                      />
                    ) : (
                      <p className="font-display font-bold text-h5 text-ink-primary dark:text-night-text truncate">{s.name}</p>
                    )}
                    <p className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted mt-0.5">
                      {careerPlanLabel(t, s.careerId, s.plan)} · {new Date(s.updatedAt).toLocaleDateString(i18n.language)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 md:ml-auto">
                    {isRenaming ? (
                      <>
                        <Button size="sm" onClick={commitRename} loading={busy} disabled={!renaming.name.trim()}>{t('saved.save')}</Button>
                        <Button size="sm" variant="ghost" onClick={() => setRenaming(null)} disabled={busy}>{t('ui.cancel')}</Button>
                      </>
                    ) : (
                      <>
                        {list.length >= 2 && (
                          <Checkbox
                            checked={comparing.has(s.id)}
                            onChange={() => toggleComparing(s.id)}
                            label={t('saved.compareToggle')}
                            aria-label={t('saved.compareToggleAria', { name: s.name })}
                          />
                        )}
                        <Button size="sm" variant="outline" onClick={() => open(s)}>{t('saved.open')}</Button>
                        <Button size="sm" variant="outline" onClick={() => share(s)} loading={busy}>{t('saved.share')}</Button>
                        <Button size="sm" variant="ghost" onClick={() => setRenaming({ id: s.id, name: s.name })}>{t('saved.rename')}</Button>
                        <Button size="sm" variant="dangerGhost" onClick={() => setDeleting({ schedule: s, busy: false, error: null })}>{t('saved.delete')}</Button>
                      </>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </main>

      {deleting && (
        <ConfirmDialog
          title={t('saved.confirmDeleteTitle')}
          body={t('saved.confirmDeleteBody', { name: deleting.schedule.name })}
          confirmLabel={t('saved.confirmDeleteAction')}
          busy={deleting.busy}
          error={deleting.error}
          onConfirm={confirmDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  )
}
