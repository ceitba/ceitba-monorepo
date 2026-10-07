import { useSearchParams, useParams, useNavigate, useLocation, Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import CourseView from '../components/CourseView'
import { SettingsView } from '../components/SettingsView'
import { SchedulerPreview, type NoResultReasons } from '../components/SchedulerPreview'
import { SchedulerBackLink } from '../components/SchedulerHeader'
import CommissionSelectionModal from '../components/CommissionSelectionModal'
import SaveScheduleDialog from '../components/SaveScheduleDialog'
import ClassDetailModal from '../components/corrections/ClassDetailModal'
import { Subject, useSubjects } from '../hooks/useSubjects'
import { useAuth } from '@/hooks/useAuth'
import { useState, useEffect, useMemo, useRef, useCallback, type ReactNode } from 'react'
import { detectConflicts, liveSlotsFromCourses } from '../services/conflicts'
import { normalizePlanId, denormalizePlanId } from '../utils/planUtils'
import { DEFAULT_SCHEDULER_OPTIONS, subjectsBlockedOut, type GenerationResult } from '../services/scheduler'
import { useScheduleGeneration } from '../hooks/useScheduleGeneration'
import type { GenerationInputs } from '../workers/protocol'
import { PossibleSchedule, SchedulerOptions, TimeBlock } from '../types/scheduler'
import { AVAILABLE_PLANS, CAREERS } from '../types/careers'
import { buildIcs, eventsFromSlots, googleCalendarUrl, type CalendarEvent } from '../utils/ics'
import { createSavedSchedule, isLimitReached, listSavedSchedules, MAX_SAVED_SCHEDULES, type SavedSchedule } from '../api/schedules'
import { errorMessageKey } from '../services/apiErrors'
import { CorrectionsContext, type CorrectionsContextValue } from '../context/correctionsContext'
import { mergeCorrection, sameSlotSet } from '../services/corrections'
import { discardPendingWorkspace, parsePayload, savePendingWorkspace, takePendingWorkspace, type SavedSchedulePayload } from '../services/workspaceSnapshot'
import { SignInContext } from '../context/signInContext'
import { startGoogleSignIn } from '@/store/authStore'
import type { CommissionCorrection } from '../types/scheduler'
import { SCHEDULER_BASE, schedulerPath } from '../paths'
import { Button, Modal, Tabs, ToggleGroup, buttonClass, toast } from '@/components/ui'

interface SelectedCourse extends Subject {
  selectedCommissions: string[]
}

interface CalendarLink {
  url: string
  title: string
  commission?: string
}

const VALID_CAREERS = Object.keys(AVAILABLE_PLANS)
const NO_SCHEDULES: PossibleSchedule[] = []

// The workspace tabs. The pending-workspace snapshot stores the active tab
// as its index in this list.
const TAB_IDS = ['courses', 'settings', 'calendar'] as const
type TabId = (typeof TAB_IDS)[number]

// Validates the route, then mounts the workspace keyed by career + plan so
// switching plan starts from a clean slate (no courses or schedules from
// the previous plan's catalog leak across).
export default function CareerPage() {
  const { career } = useParams<{ career: string }>()
  const [searchParams] = useSearchParams()
  const normalizedPlan = searchParams.get('plan')

  if (!career || !VALID_CAREERS.includes(career)) {
    return <Navigate to={SCHEDULER_BASE} replace />
  }

  const validPlans = AVAILABLE_PLANS[career as keyof typeof AVAILABLE_PLANS].map(p => normalizePlanId(p.id))

  if (!normalizedPlan || !validPlans.includes(normalizedPlan)) {
    const defaultPlan = normalizePlanId(AVAILABLE_PLANS[career as keyof typeof AVAILABLE_PLANS][0].id)
    return <Navigate to={schedulerPath(`/${career}?plan=${defaultPlan}`)} replace />
  }

  return <CareerWorkspace key={`${career}|${normalizedPlan}`} career={career} normalizedPlan={normalizedPlan} />
}

function CareerWorkspace({ career, normalizedPlan }: { career: string; normalizedPlan: string }) {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { profile } = useAuth()
  const preselectedSubjectsIds = useRef(searchParams.getAll('code'))
  const plan = denormalizePlanId(normalizedPlan)
  const careerPlans = AVAILABLE_PLANS[career as keyof typeof AVAILABLE_PLANS] ?? []
  const { subjects, loading: subjectsLoading, error: subjectsError, updateCommission, refetch: refetchSubjects } = useSubjects(plan)

  // ALL useState / useRef declarations come first, so the useEffect dep
  // arrays that follow can reference them without hitting TDZ during render.
  // (Hooks must be called in the same order each render; arranging them
  // declarations-first → effects-second satisfies both rules cleanly.)
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveBusy, setSaveBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  // Anonymous user pressed "Guardar horario": explain sign-in first.
  const [signInToSave, setSignInToSave] = useState(false)
  const [savedCount, setSavedCount] = useState(0)
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedCourseForModal, setSelectedCourseForModal] = useState<Subject | null>(null)
  const [selectedCourses, setSelectedCourses] = useState<SelectedCourse[]>([])
  // Generator inputs live here (single source of truth) and flow down as
  // props, so a restored saved schedule reaches every mounted tab.
  const [options, setOptions] = useState<SchedulerOptions>(DEFAULT_SCHEDULER_OPTIONS)
  const [blockedTimes, setBlockedTimes] = useState<TimeBlock[]>([])
  // Generation is lazy: requested by opening the calendar tab or changing
  // its options, and dropped whenever courses/blocked times change.
  const [generationRequested, setGenerationRequested] = useState(false)
  // Index into `schedules` of the option the preview shows; exports use it.
  // Tagged with the result it indexes so a new result starts at option 1.
  const [selection, setSelection] = useState<{ result: GenerationResult | null; index: number }>({ result: null, index: 0 })
  const [isCalendarPanelOpen, setIsCalendarPanelOpen] = useState(false)
  const [remainingCalendarUrls, setRemainingCalendarUrls] = useState<CalendarLink[]>([])
  const [scheduleEvents, setScheduleEvents] = useState<CalendarEvent[]>([])
  // Class block whose detail dialog is open (opened from the calendar grid).
  const [classDetail, setClassDetail] = useState<{ subjectId: string; commissionName: string } | null>(null)
  const [activeTab, setActiveTab] = useState<TabId>('courses')
  const restoredId = useRef<string | null>(null)
  const preselectApplied = useRef(false)
  const pendingWorkspaceChecked = useRef(false)

  // New identity only when an input changes, which is what triggers a
  // (re)generation in the worker. Plain data, so it can be posted as is.
  const generationInputs = useMemo<GenerationInputs | null>(
    () => (generationRequested ? { subjects: selectedCourses, options, blockedTimes } : null),
    [generationRequested, selectedCourses, options, blockedTimes],
  )
  const { result: generation, pending: generating } = useScheduleGeneration(generationInputs)
  const schedules = generation?.schedules ?? NO_SCHEDULES
  const currentIndex = selection.result === generation ? selection.index : 0
  const setCurrentIndex = (index: number) => setSelection({ result: generation, index })
  const currentSchedule: PossibleSchedule | null = schedules[currentIndex] ?? null

  // Same URL shape the ?code= preselect flow reads: /<career>?plan=<plan>&code=<id>...
  // (commissions aren't part of it; preselected subjects get all commissions).
  const shareUrl = useMemo(() => {
    const url = new URL(window.location.href)
    url.search = ''
    url.hash = ''
    url.searchParams.set('plan', normalizedPlan)
    selectedCourses.forEach((c) => url.searchParams.append('code', c.subject_id))
    return url.toString()
  }, [normalizedPlan, selectedCourses])

  // Schedule corrections: the catalog is the source of truth for what
  // students said; a correction returned by the API is folded into it in
  // place. Selected courses carry their own copy of the commissions (the
  // generator's input), so they're only touched when the effective
  // schedule changes; that new identity regenerates the options (if the
  // calendar was requested) while a mere vote count change doesn't.
  const handleCorrectionChange = useCallback(
    (subjectId: string, commissionName: string, correction: CommissionCorrection) => {
      updateCommission(subjectId, commissionName, (c) => mergeCorrection(c, correction))
      setSelectedCourses((prev) => {
        let changed = false
        const next = prev.map((course) => {
          if (course.subject_id !== subjectId) return course
          return {
            ...course,
            commissions: course.commissions.map((c) => {
              if (c.name !== commissionName) return c
              const merged = mergeCorrection(c, correction)
              if (sameSlotSet(merged.schedule, c.schedule)) return c
              changed = true
              return merged
            }),
          }
        })
        return changed ? next : prev
      })
    },
    [updateCommission],
  )
  const subjectsById = useMemo(() => new Map(subjects.map((s) => [s.subject_id, s])), [subjects])
  const correctionsContext = useMemo<CorrectionsContextValue>(
    () => ({
      findCommission: (subjectId, commissionName) => {
        const subject = subjectsById.get(subjectId)
        const commission = subject?.commissions.find((c) => c.name === commissionName)
        return subject && commission ? { subject, commission } : null
      },
      onCorrectionChange: handleCorrectionChange,
      openClassDetail: (subjectId, commissionName) => setClassDetail({ subjectId, commissionName }),
    }),
    [subjectsById, handleCorrectionChange, setClassDetail],
  )

  const liveSlots = useMemo(() => liveSlotsFromCourses(selectedCourses), [selectedCourses])
  const conflictReport = useMemo(() => detectConflicts(selectedCourses), [selectedCourses])
  const liveConflictCount = conflictReport.totalConflicts

  // Explains an empty generation: subjects that clash in every commission
  // and subjects all of whose commissions hit a blocked time.
  const noResultReasons = useMemo<NoResultReasons>(() => {
    const names = new Map(selectedCourses.map((c) => [c.subject_id, c.name]))
    const clashes: [string, string][] = []
    Object.entries(conflictReport.perSubject).forEach(([id, status]) => {
      status.conflictsWith.forEach((other) => {
        if (other.level === 'all' && id < other.subjectId) clashes.push([names.get(id) ?? id, other.subjectName])
      })
    })
    return {
      clashes,
      blockedOut: subjectsBlockedOut(selectedCourses, blockedTimes).map((c) => c.name),
      hasBlockedTimes: blockedTimes.length > 0,
    }
  }, [selectedCourses, conflictReport, blockedTimes])

  // savedCount is only shown to a signed-in user (anonymous users are asked
  // to sign in first), so there's nothing to reset on sign-out.
  useEffect(() => {
    if (!profile) return
    let ignore = false
    // Only feeds the X/MAX hint in the save dialog; the server enforces
    // the cap anyway.
    listSavedSchedules().then((l) => { if (!ignore) setSavedCount(l.length) }).catch((e) => console.error(e))
    return () => { ignore = true }
  }, [profile])

  // Replaces the workspace inputs with a saved payload. Subjects missing
  // from the current catalog are dropped.
  const applyPayload = useCallback((payload: SavedSchedulePayload) => {
    const byId = new Map(subjects.map((s) => [s.subject_id, s]))
    const restoredCourses: SelectedCourse[] = payload.selectedCourses
      .map((sc) => {
        const subject = byId.get(sc.subject_id)
        if (!subject) return null
        return { ...subject, selectedCommissions: sc.selectedCommissions }
      })
      .filter((x): x is SelectedCourse => x !== null)
    setSelectedCourses(restoredCourses)
    setOptions(payload.options)
    setBlockedTimes(payload.blockedTimes.map((b) => ({ ...b, id: b.id ?? crypto.randomUUID() })))
    setGenerationRequested(false)
  }, [subjects])

  // `shownCombination` records the option on screen in the Calendario
  // tab (one commission per subject), so a comparison shows that one.
  const currentPayload = (withShown = false): SavedSchedulePayload => {
    const shown = withShown && currentSchedule
      ? Array.from(new Map(currentSchedule.slots.map((s) => [s.subject_id, s.commission])), ([subject_id, commission]) => ({ subject_id, commission }))
      : null
    return {
      version: 1,
      selectedCourses: selectedCourses.map((c) => ({
        subject_id: c.subject_id,
        selectedCommissions: c.selectedCommissions,
      })),
      options,
      blockedTimes,
      ...(shown ? { shownCombination: shown } : {}),
    }
  }

  // Every sign-in button on this page (navbar, corrections) goes through
  // here: the workspace only lives in React state, so it's snapshotted to
  // sessionStorage before the redirect to Google and restored on return
  // (effect below).
  const beginSignIn = () => {
    savePendingWorkspace({
      career,
      plan: normalizedPlan,
      codes: preselectedSubjectsIds.current,
      savedAt: Date.now(),
      activeTab: TAB_IDS.indexOf(activeTab),
      payload: currentPayload(),
    })
    startGoogleSignIn(location.pathname + location.search)
  }

  // Restore the workspace snapshotted before a sign-in redirect, once the
  // catalog has loaded; the snapshot is deleted whether or not it applies.
  // Precedence:
  //  1. A saved schedule opened from /saved (router state) wins; the
  //     snapshot is discarded.
  //  2. Otherwise the snapshot wins over the ?code= preselect: it only
  //     applies on a URL with the same preselect it was taken on, so it
  //     already holds the preselect plus the student's edits since.
  //  3. It never replaces courses already picked on this page.
  // Stale (> 30 min), other career/plan/preselect, unknown version or malformed
  // snapshots are ignored (see takePendingWorkspace).
  useEffect(() => {
    if (pendingWorkspaceChecked.current || !subjects.length) return
    pendingWorkspaceChecked.current = true
    const pending = takePendingWorkspace(career, normalizedPlan, preselectedSubjectsIds.current)
    if (!pending) return
    const navState = location.state as { savedSchedule?: SavedSchedule } | null
    if (navState?.savedSchedule || selectedCourses.length > 0) return
    preselectApplied.current = true
    // Applying a one-off snapshot handed over through sessionStorage (an
    // external system) once the catalog it refers to has loaded.
    applyPayload(pending.payload)
    const tab = TAB_IDS[pending.activeTab] ?? 'courses'
    setActiveTab(tab)
    // The calendar tab generates on open; reopening it must too.
    if (tab === 'calendar') setGenerationRequested(true)
  }, [subjects, career, normalizedPlan, location.state, selectedCourses.length, applyPayload])

  // Backing out of Google (browser back) can bring this page back from the
  // back/forward cache with its workspace still in memory: nothing needs
  // restoring, and the snapshot left behind would otherwise resurface over
  // a fresh visit to this page later.
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => { if (e.persisted) discardPendingWorkspace() }
    window.addEventListener('pageshow', onPageShow)
    return () => window.removeEventListener('pageshow', onPageShow)
  }, [])

  // Add preselected subjects from ?code= URL params, once per mount (the
  // workspace remounts on plan change), skipping ones already selected.
  useEffect(() => {
    if (preselectApplied.current) return
    if (!preselectedSubjectsIds.current.length || !subjects.length) return
    preselectApplied.current = true
    const preselected = subjects.filter(s => preselectedSubjectsIds.current.includes(s.subject_id))
    setSelectedCourses(prev => {
      const have = new Set(prev.map(c => c.subject_id))
      return [
        ...prev,
        ...preselected
          .filter(s => !have.has(s.subject_id))
          .map(s => ({ ...s, selectedCommissions: s.commissions.map(c => c.name) })),
      ]
    })
  }, [subjects])

  // Restore from a saved schedule once the subject catalog is loaded.
  // Effect guards: same id never re-applies; missing subjects pause until
  // they arrive; unknown payload versions skip silently. After applying we
  // wipe location.state so a refresh / back-forward doesn't re-restore an
  // already-merged snapshot.
  useEffect(() => {
    if (!subjects.length) return
    const navState = location.state as { savedSchedule?: SavedSchedule } | null
    const saved = navState?.savedSchedule
    if (!saved) return
    if (restoredId.current === saved.id) return
    const payload = parsePayload(saved.payload)
    if (!payload) { restoredId.current = saved.id; return }
    // Applying a one-off snapshot handed over through router history state
    // (an external system) and then consuming it with navigate(), which is
    // a side effect and can't run during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
    applyPayload(payload)
    restoredId.current = saved.id
    navigate(location.pathname + location.search, { replace: true, state: null })
  }, [subjects, location.state, location.pathname, location.search, navigate, applyPayload])

  // Any change to the course/blocked-time inputs invalidates the current
  // results; the next visit to the calendar tab regenerates them.
  function clearSchedules() {
    setGenerationRequested(false)
  }

  const updateSelectedCourses = (updated: SelectedCourse[]) => {
    setSelectedCourses(updated)
    clearSchedules()
  }

  const handleCommissionSelect = (commissions: string[]) => {
    if (selectedCourseForModal) {
      // The live catalog entry, not the copy captured when the dialog opened:
      // a correction applied inside the dialog must reach the generator.
      const subject = subjectsById.get(selectedCourseForModal.subject_id) ?? selectedCourseForModal
      updateSelectedCourses([...selectedCourses, { ...subject, selectedCommissions: commissions }])
      setSelectedCourseForModal(null)
      setModalOpen(false)
    }
  }

  const handleOptionsChange = (next: SchedulerOptions) => {
    setOptions(next)
    setGenerationRequested(true)
  }

  const handleBlockedTimesChange = (blocks: TimeBlock[]) => {
    setBlockedTimes(blocks)
    clearSchedules()
  }

  async function handleSave(name: string) {
    setSaveBusy(true); setSaveError(null)
    try {
      // The shown option only means something while the Calendario tab
      // displays results for the current inputs.
      const payload = currentPayload(activeTab === 'calendar')
      const saved = await createSavedSchedule({
        name,
        careerId: career ?? null,
        plan: plan ?? null,
        payload: payload as unknown as Record<string, unknown>,
      })
      setSavedCount((c) => c + 1)
      setSaveOpen(false)
      toast.success(t('saved.toastSaved', { name: saved.name }), {
        label: t('saved.viewSaved'),
        onClick: () => navigate(schedulerPath('/saved')),
      })
    } catch (e) {
      setSaveError(isLimitReached(e)
        ? t('saved.limitReached', { max: MAX_SAVED_SCHEDULES })
        : t(errorMessageKey(e, 'saved.errors.saveFailed')))
    } finally {
      setSaveBusy(false)
    }
  }

  const openSave = () => {
    if (!profile) { setSignInToSave(true); return }
    setSaveError(null)
    setSaveOpen(true)
  }

  // Generates the combinations and shows them.
  const viewCombinations = () => {
    setGenerationRequested(true)
    setActiveTab('calendar')
  }

  const changeTab = (tab: TabId) => {
    setActiveTab(tab)
    // Opening the calendar generates the combinations for the current inputs.
    if (tab === 'calendar') setGenerationRequested(true)
  }

  const downloadIcs = () => {
    try {
      const blob = new Blob([buildIcs(scheduleEvents)], { type: 'text/calendar;charset=utf-8' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = 'horario.ics'
      link.click()
      setTimeout(() => URL.revokeObjectURL(link.href), 0)
    } catch (e) {
      console.error(e)
      toast.error(t('save.exportFailed'))
    }
  }

  const handleExportToCalendar = () => {
    if (!currentSchedule) return
    setIsCalendarPanelOpen(true)
    const events = eventsFromSlots(
      currentSchedule.slots,
      (slot) => t('calendar.commissionName', { name: slot.commission }),
    )
    setScheduleEvents(events)
    setRemainingCalendarUrls(
      events.flatMap((e) => {
        const url = googleCalendarUrl(e)
        return url ? [{ url, title: e.title, commission: e.commission }] : []
      }),
    )
  }

  const panels: Record<TabId, ReactNode> = {
    courses: (
      <CourseView
        subjects={subjects}
        loading={subjectsLoading}
        error={subjectsError}
        onRetry={refetchSubjects}
        selectedCourses={selectedCourses}
        conflictReport={conflictReport}
        onCommissionSelect={course => {
          if (!modalOpen) { setSelectedCourseForModal(course); setModalOpen(true) }
        }}
        onAddCourse={(course, commissions) => {
          updateSelectedCourses([...selectedCourses, { ...course, selectedCommissions: commissions }])
        }}
        onRemoveCourse={courseId => {
          const before = selectedCourses
          const removed = before.find(c => c.subject_id === courseId)
          updateSelectedCourses(before.filter(c => c.subject_id !== courseId))
          if (removed) {
            toast.info(t('courses.removed', { name: removed.name }), {
              label: t('courses.undo'),
              // Puts it back where it was, unless it was re-added meanwhile.
              onClick: () => {
                clearSchedules()
                setSelectedCourses(current => {
                  if (current.some(c => c.subject_id === courseId)) return current
                  const at = Math.min(before.indexOf(removed), current.length)
                  return [...current.slice(0, at), removed, ...current.slice(at)]
                })
              },
            })
          }
        }}
        onReorderCourses={updateSelectedCourses}
        onViewCombinations={viewCombinations}
      />
    ),
    settings: <SettingsView blockedTimes={blockedTimes} onChange={handleBlockedTimesChange} />,
    calendar: (
      <SchedulerPreview
        schedules={schedules}
        truncated={generation?.truncated ?? false}
        stepLimitReached={generation?.stepLimitReached ?? false}
        generated={generation !== null}
        generating={generating}
        currentIndex={currentIndex}
        onIndexChange={setCurrentIndex}
        options={options}
        onOptionsChange={handleOptionsChange}
        blockedTimes={blockedTimes}
        hasSubjects={selectedCourses.length > 0}
        onExportToCalendar={handleExportToCalendar}
        shareUrl={shareUrl}
        liveSlots={liveSlots}
        liveConflictCount={liveConflictCount}
        noResultReasons={noResultReasons}
        onViewCombinations={viewCombinations}
        onGoToTab={changeTab}
      />
    ),
  }

  return (
    <SignInContext.Provider value={beginSignIn}>
    <CorrectionsContext.Provider value={correctionsContext}>
      <div className="flex flex-col bg-surface dark:bg-night-bg">
        <main id="main-content" className="flex-1">
          <div className="container-content py-6">
            <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 mb-4">
              <div className="flex flex-col min-w-0">
                <SchedulerBackLink label={t('career.changeCareer')} />
                <h1 className="font-display text-h3 font-bold text-ink-primary dark:text-night-text leading-tight">
                  {(career && CAREERS[career]) || career}
                </h1>
                {careerPlans.length > 1 && plan ? (
                  <div className="flex flex-wrap items-center gap-3 mt-2">
                    <span id="career-plan-label" className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
                      {t('career.plan')}
                    </span>
                    <ToggleGroup
                      joined
                      labelledBy="career-plan-label"
                      value={plan}
                      onChange={(id) => navigate(schedulerPath(`/${career}?plan=${normalizePlanId(id)}`))}
                      options={careerPlans.map((p) => ({ value: p.id, label: p.id }))}
                    />
                  </div>
                ) : plan ? (
                  <p className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted mt-1">
                    {t('saved.planLabel', { plan })}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-col items-start sm:items-end gap-1">
                <Button variant="outline" size="sm" onClick={openSave} disabled={selectedCourses.length === 0}>
                  {t('saved.saveSchedule')}
                </Button>
                {selectedCourses.length === 0 && (
                  <p className="font-body text-label text-ink-secondary dark:text-night-muted">{t('saved.saveDisabledHint')}</p>
                )}
              </div>
            </header>
            <Tabs
              items={TAB_IDS.map((id) => ({ id, label: t(`career.tabs.${id}`) }))}
              active={activeTab}
              onChange={changeTab}
              label={t('career.tabsAria')}
              idPrefix="workspace"
            />
            {TAB_IDS.map((id) => (
              // All panels stay mounted (they hold state); only one shows.
              <div
                key={id}
                role="tabpanel"
                id={`workspace-panel-${id}`}
                aria-labelledby={`workspace-tab-${id}`}
                hidden={activeTab !== id}
                className="mt-6"
              >
                {panels[id]}
              </div>
            ))}
          </div>
        </main>

        {saveOpen && (
          <SaveScheduleDialog
            count={savedCount}
            max={MAX_SAVED_SCHEDULES}
            busy={saveBusy}
            error={saveError}
            onSave={handleSave}
            onClose={() => setSaveOpen(false)}
          />
        )}

        {signInToSave && (
          <Modal
            title={t('saved.signInTitle')}
            size="sm"
            onClose={() => setSignInToSave(false)}
            footer={
              <>
                <Button variant="ghost" onClick={() => setSignInToSave(false)}>{t('ui.cancel')}</Button>
                <Button onClick={beginSignIn}>{t('saved.signInAction')}</Button>
              </>
            }
          >
            <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">{t('saved.signInBody')}</p>
          </Modal>
        )}

        {modalOpen && selectedCourseForModal && (
          <CommissionSelectionModal
            key={selectedCourseForModal.subject_id}
            onClose={() => { setModalOpen(false); setSelectedCourseForModal(null) }}
            // The live catalog entry, so corrections made in the dialog show up in it.
            subject={subjectsById.get(selectedCourseForModal.subject_id) ?? selectedCourseForModal}
            onAddCommissions={handleCommissionSelect}
          />
        )}

        {classDetail && (
          <ClassDetailModal
            subjectId={classDetail.subjectId}
            commissionName={classDetail.commissionName}
            onClose={() => setClassDetail(null)}
          />
        )}

        {isCalendarPanelOpen && (
          <Modal
            title={t('calendar.title')}
            size="lg"
            onClose={() => setIsCalendarPanelOpen(false)}
            footer={<Button variant="ghost" onClick={() => setIsCalendarPanelOpen(false)}>{t('ui.close')}</Button>}
          >
            <section className="p-4 rounded-card border border-border dark:border-night-border bg-surface dark:bg-night-bg">
              <h4 className="font-body font-semibold text-body text-ink-primary dark:text-night-text mb-2">{t('calendar.option1Title')}</h4>
              <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted mb-4">
                {t('calendar.option1Description')}
              </p>
              <ol className="list-decimal pl-5 font-body text-body-sm text-ink-secondary dark:text-night-muted space-y-1.5 mb-4">
                <li>{t('calendar.option1Step1')}</li>
                <li>
                  {t('calendar.option1Step2')}{' '}
                  <a href="https://calendar.google.com" target="_blank" rel="noopener noreferrer" className="text-primary dark:text-primary-300 underline">
                    {t('calendar.googleCalendar')}
                  </a>
                </li>
                <li>{t('calendar.option1Step3')}</li>
                <li>{t('calendar.option1Step4')}</li>
              </ol>
              <Button block onClick={downloadIcs}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
                </svg>
                {t('calendar.downloadFile')}
              </Button>
            </section>

            <section className="p-4 rounded-card border border-border dark:border-night-border bg-surface dark:bg-night-bg">
              <h4 className="font-body font-semibold text-body text-ink-primary dark:text-night-text mb-1">{t('calendar.option2Title')}</h4>
              <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted mb-3">{t('calendar.option2Description')}</p>
              {remainingCalendarUrls.length === 0 ? (
                <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">{t('calendar.allAdded')}</p>
              ) : (
                <div className="space-y-2">
                  {remainingCalendarUrls.map((event) => (
                    <a
                      key={event.url}
                      href={event.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setRemainingCalendarUrls(prev => prev.filter((e) => e.url !== event.url))}
                      className={buttonClass({ variant: 'outline', block: true, className: '!justify-start !normal-case !tracking-normal !font-body text-body-sm text-left' })}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-primary dark:text-primary-300 flex-shrink-0" aria-hidden="true">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                        <line x1="16" y1="2" x2="16" y2="6" />
                        <line x1="8" y1="2" x2="8" y2="6" />
                        <line x1="3" y1="10" x2="21" y2="10" />
                      </svg>
                      <span className="line-clamp-1">
                        {event.commission
                          ? t('calendar.eventWithCommission', { title: event.title, commission: event.commission })
                          : event.title}
                      </span>
                    </a>
                  ))}
                </div>
              )}
            </section>
          </Modal>
        )}
      </div>
    </CorrectionsContext.Provider>
    </SignInContext.Provider>
  )
}
