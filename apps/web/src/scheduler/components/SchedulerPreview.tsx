import React, { useState, useRef } from "react"
import { useTranslation } from "react-i18next"
import { PossibleSchedule, ScheduleSlot, SchedulerOptions, TimeBlock } from "../types/scheduler"
import ScheduleGrid from "./ScheduleGrid"
import Checkbox from "./Checkbox"
import ExportModal from "./ExportModal"
import WallpaperLayout from "./WallpaperLayout"
import ScheduleGridSkeleton from "./ScheduleGridSkeleton"
import { WEEKDAYS } from "../services/time"
import { Alert, Button, EmptyState, IconButton, LoadingRegion, toast } from "@/components/ui"

// Why the last generation found nothing, worked out by CareerPage.
export interface NoResultReasons {
  // Pairs of subject names that clash in every commission.
  clashes: [string, string][]
  // Subjects whose every commission hits a blocked time.
  blockedOut: string[]
  hasBlockedTimes: boolean
}

type OverlapMode = "none" | "limited" | "unlimited"
const OVERLAP_MODES: OverlapMode[] = ["none", "limited", "unlimited"]

const overlapModeOf = (o: SchedulerOptions): OverlapMode =>
  o.allowUnlimitedOverlap ? "unlimited" : o.allowOverlap ? "limited" : "none"

// The saved/restored options keep their two flags; this is the one control.
const withOverlapMode = (o: SchedulerOptions, mode: OverlapMode): SchedulerOptions => ({
  ...o,
  allowOverlap: mode !== "none",
  allowUnlimitedOverlap: mode === "unlimited",
})

interface SchedulerPreviewProps {
  // Generated combinations, already filtered by `options` and ranked.
  schedules: PossibleSchedule[]
  truncated: boolean
  // The search budget (not the result cap) stopped the search.
  stepLimitReached: boolean
  generated: boolean
  // A generation for the current inputs is running (in a Web Worker).
  generating?: boolean
  currentIndex: number
  onIndexChange: (index: number) => void
  options: SchedulerOptions
  onOptionsChange: (options: SchedulerOptions) => void
  blockedTimes: TimeBlock[]
  hasSubjects: boolean
  onExportToCalendar: () => void
  // Link that reopens this career/plan with the selected subjects (?code=).
  shareUrl: string
  liveSlots?: ScheduleSlot[]
  liveConflictCount?: number
  noResultReasons: NoResultReasons
  onViewCombinations: () => void
  onGoToTab: (tab: "courses" | "settings") => void
}

// "A, B y C"
const joinNames = (names: string[], and: string) =>
  names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} ${and} ${names[names.length - 1]}`

// Renders a copy of the schedule offscreen at 1920x1080 (so the export
// doesn't depend on the viewport) and returns the canvas. Day headers are
// replaced with their full names from `fullDayNames`.
async function captureSchedule(element: HTMLElement, fullDayNames: Record<string, string>): Promise<HTMLCanvasElement> {
  const wrapper = document.createElement('div')
  Object.assign(wrapper.style, {
    position: 'fixed',
    top: '-9999px',
    left: '-9999px',
    width: '1920px',
    height: '1080px',
    backgroundColor: '#FAFAF8',
    padding: '40px',
    overflow: 'hidden',
  })

  const clone = element.cloneNode(true) as HTMLElement
  Object.assign(clone.style, { width: '100%', height: '100%', transform: 'scale(1)', transformOrigin: 'top left' })
  wrapper.appendChild(clone)
  document.body.appendChild(wrapper)

  try {
    // Export libraries load on first use, not with the scheduler chunk.
    const { default: html2canvas } = await import('html2canvas')
    // The brand web fonts must be ready before the canvas draws text.
    await document.fonts?.ready
    return await html2canvas(wrapper, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      logging: false,
      backgroundColor: null,
      width: 1920,
      height: 1080,
      onclone: (clonedDoc) => {
        const style = clonedDoc.createElement('style')
        style.textContent = `* { print-color-adjust: exact; -webkit-print-color-adjust: exact; }`
        clonedDoc.head.appendChild(style)

        const dayHeaders = clonedDoc.querySelectorAll('.grid-cols-\\[auto_1fr_1fr_1fr_1fr_1fr\\] > div')
        dayHeaders.forEach((header: Element, index) => {
          if (index === 0) return
          const full = fullDayNames[header.textContent?.trim() ?? '']
          if (full) header.textContent = full
        })
      },
    })
  } finally {
    document.body.removeChild(wrapper)
  }
}

const ExportIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
)

export const SchedulerPreview: React.FC<SchedulerPreviewProps> = ({
  schedules,
  truncated,
  stepLimitReached,
  generated,
  generating = false,
  currentIndex,
  onIndexChange,
  options,
  onOptionsChange,
  blockedTimes,
  hasSubjects,
  onExportToCalendar,
  shareUrl,
  liveSlots = [],
  liveConflictCount = 0,
  noResultReasons,
  onViewCombinations,
  onGoToTab,
}) => {
  const { t } = useTranslation()
  const [isExportOpen, setIsExportOpen] = useState(false)
  const scheduleRef = useRef<HTMLDivElement>(null)
  const wallpaperRef = useRef<HTMLDivElement>(null)

  const currentSchedule: PossibleSchedule | undefined = schedules[currentIndex]
  const overlapMode = overlapModeOf(options)

  const handlePrevSchedule = () => {
    if (schedules.length > 0) {
      onIndexChange(currentIndex > 0 ? currentIndex - 1 : schedules.length - 1)
    }
  }

  const handleNextSchedule = () => {
    if (schedules.length > 0) {
      onIndexChange(currentIndex < schedules.length - 1 ? currentIndex + 1 : 0)
    }
  }

  const hasSchedules = schedules.length > 0
  const showResults = hasSubjects && !generating && hasSchedules

  const renderScheduleInfo = (schedule: PossibleSchedule) => {
    const item = (good: boolean, label: string) => (
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${good ? "bg-emerald-500" : "bg-amber-500"}`} aria-hidden="true" />
        <span>{label}</span>
      </div>
    )
    return (
      <div className="flex flex-col gap-2 lg:flex-row lg:justify-between">
        <div className="flex flex-wrap gap-3 font-body text-body-sm text-ink-secondary dark:text-night-muted items-center">
          {item(!schedule.maxOverlap, schedule.maxOverlap ? t('scheduler.hasOverlap') : t('scheduler.noOverlap'))}
          {item(!schedule.hasBuildingConflict, schedule.hasBuildingConflict ? t('scheduler.buildingConflict') : t('scheduler.noBuildingConflict'))}
          {item(schedule.hasFreeDay, schedule.hasFreeDay ? t('scheduler.hasFreeDay') : t('scheduler.noFreeDay'))}
        </div>
        {blockedTimes.length > 0 && (
          <div className="flex items-center gap-2 font-mono text-label text-ink-secondary dark:text-night-muted">
            <div className="w-5 h-5 border-2 border-dashed border-ink-secondary/30 dark:border-night-muted/30 bg-surface dark:bg-night-bg" aria-hidden="true"></div>
            <span>{t('scheduler.blockedTime')}</span>
          </div>
        )}
      </div>
    )
  }

  // Header labels are short day names ("Lun"); exports spell them out.
  const fullDayNames = Object.fromEntries(
    WEEKDAYS.map((d) => [t(`days.${d}`), t(`daysFull.${d}`)])
  )

  const handleSaveAsPDF = async () => {
    if (!scheduleRef.current) return
    try {
      const canvas = await captureSchedule(scheduleRef.current, fullDayNames)
      const imgData = canvas.toDataURL('image/png', 1.0)
      const { default: jsPDF } = await import('jspdf')
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [canvas.width, canvas.height] })
      pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height)
      pdf.save('horario.pdf')
    } catch (error) {
      console.error('Error generating PDF:', error)
      toast.error(t('save.exportFailed'))
    }
  }

  const handleSaveAsImage = async () => {
    if (!scheduleRef.current) return
    try {
      const canvas = await captureSchedule(scheduleRef.current, fullDayNames)
      const link = document.createElement('a')
      link.download = 'horario.png'
      link.href = canvas.toDataURL('image/png', 1.0)
      link.click()
    } catch (error) {
      console.error('Error generating image:', error)
      toast.error(t('save.exportFailed'))
    }
  }

  const handleShareLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      toast.success(t('save.linkCopied'))
    } catch {
      toast.error(t('save.linkCopyFailed', { url: shareUrl }))
    }
  }

  // 9:16 phone wallpaper. The WallpaperLayout component is mounted
  // offscreen at exactly 1080x1920 so html2canvas captures it 1:1 — no
  // scaling, no font-substitution surprises.
  const handleSaveAsWallpaper = async () => {
    if (!wallpaperRef.current) return
    try {
      const { default: html2canvas } = await import('html2canvas')
      await document.fonts?.ready
      const canvas = await html2canvas(wallpaperRef.current, {
        scale: 1,
        useCORS: true,
        allowTaint: true,
        logging: false,
        backgroundColor: '#FAFAF8',
        width: 1080,
        height: 1920,
      })
      const link = document.createElement('a')
      link.download = 'horario-wallpaper.png'
      link.href = canvas.toDataURL('image/png', 1.0)
      link.click()
    } catch (error) {
      console.error('Error generating wallpaper:', error)
      toast.error(t('save.exportFailed'))
    }
  }

  const { clashes, blockedOut, hasBlockedTimes } = noResultReasons
  const noResultItems = [
    ...(blockedOut.length > 0
      ? [t('scheduler.noResult.blockedOut', { count: blockedOut.length, names: joinNames(blockedOut, t('scheduler.and')) })]
      : []),
    ...(overlapMode !== 'unlimited'
      ? clashes.slice(0, 3).map(([a, b]) => t('scheduler.noResult.clash', { a, b }))
      : []),
    ...(hasBlockedTimes && blockedOut.length === 0 ? [t('scheduler.noResult.maybeBlocked')] : []),
    ...(options.allowFreeDay ? [t('scheduler.noResult.freeDay')] : []),
    ...(overlapMode !== 'unlimited' ? [t('scheduler.noResult.allowOverlap')] : []),
  ]
  if (noResultItems.length === 0) noResultItems.push(t('scheduler.noCombinationsMessage'))

  const counter = t(truncated ? 'scheduler.optionCounterTruncated' : 'scheduler.optionCounter', {
    current: currentIndex + 1,
    total: schedules.length,
  })

  return (
    <div className="flex flex-col">
      <div className="bg-white dark:bg-night-surface rounded-card border border-border dark:border-night-border px-4 py-4">
        <div className="flex flex-col md:flex-row md:flex-wrap md:items-start gap-x-8 gap-y-3 mb-4">
          <fieldset className="min-w-0">
            <legend className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted mb-1.5">
              {t('scheduler.overlapLabel')}
            </legend>
            <div className="inline-flex flex-wrap rounded-sm border border-border dark:border-night-border overflow-hidden">
              {OVERLAP_MODES.map((mode) => (
                <label key={mode} className="cursor-pointer border-r last:border-r-0 border-border dark:border-night-border">
                  <input
                    type="radio"
                    name="overlap-mode"
                    value={mode}
                    checked={overlapMode === mode}
                    onChange={() => onOptionsChange(withOverlapMode(options, mode))}
                    className="peer sr-only"
                  />
                  <span className="inline-flex items-center min-h-[44px] px-3 font-mono text-label uppercase tracking-widest transition-colors duration-150 text-ink-secondary dark:text-night-muted hover:text-ink-primary dark:hover:text-night-text peer-checked:bg-primary peer-checked:text-white dark:peer-checked:bg-primary-400 dark:peer-checked:text-night-bg peer-focus-visible:ring-2 peer-focus-visible:ring-inset peer-focus-visible:ring-primary/50">
                    {t(`scheduler.overlap_${mode}`)}
                  </span>
                </label>
              ))}
            </div>
            <p className="mt-1 font-body text-label text-ink-secondary dark:text-night-muted">
              {t(`scheduler.overlapHint_${overlapMode}`)}
            </p>
          </fieldset>

          <div className="md:pt-5">
            <Checkbox
              checked={options.allowFreeDay}
              onChange={(checked) => onOptionsChange({ ...options, allowFreeDay: checked })}
              label={t('scheduler.freeDay')}
              hint={t('scheduler.freeDayHint')}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-border dark:border-night-border mb-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 min-w-0">
            <h2 className="font-body font-semibold text-body text-ink-primary dark:text-night-text">{t('scheduler.title')}</h2>
            {showResults && (
              <span className="font-mono text-label text-ink-secondary dark:text-night-muted whitespace-nowrap" aria-live="polite">
                {counter}
              </span>
            )}
            {showResults && schedules.length > 1 && (
              <span className="hidden lg:inline font-body text-body-sm text-ink-secondary dark:text-night-muted">
                {t('scheduler.rankingHint')}
              </span>
            )}
          </div>

          {showResults && (
            <div className="flex items-center gap-1">
              {schedules.length > 1 && (
                <>
                  <IconButton onClick={handlePrevSchedule} aria-label={t('scheduler.prevOption')}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                      <polyline points="15 18 9 12 15 6" />
                    </svg>
                  </IconButton>
                  <IconButton onClick={handleNextSchedule} aria-label={t('scheduler.nextOption')}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </IconButton>
                </>
              )}
              <Button variant="outline" size="sm" onClick={() => setIsExportOpen(true)} className="ml-1">
                <ExportIcon />
                {t('save.exportButton')}
              </Button>
            </div>
          )}
        </div>

        {hasSubjects && !generating && truncated && (
          <Alert tone="warning" className="mb-3">
            {!hasSchedules
              ? t('scheduler.searchStopped')
              : stepLimitReached
                ? t('scheduler.stepLimitNotice', { count: schedules.length })
                : t('scheduler.truncatedNotice', { count: schedules.length })}
          </Alert>
        )}

        <div ref={scheduleRef} aria-busy={hasSubjects && generating}>
          {!hasSubjects ? (
            <EmptyState
              title={t('scheduler.noSubjects')}
              body={t('scheduler.noSubjectsMessage')}
              action={<Button onClick={() => onGoToTab('courses')}>{t('scheduler.goToCourses')}</Button>}
            />
          ) : generating ? (
            <LoadingRegion>
              <ScheduleGridSkeleton />
            </LoadingRegion>
          ) : currentSchedule ? (
            <>
              <ScheduleGrid slots={currentSchedule.slots} blockedTimes={blockedTimes} />
              <div className="mt-4">
                {renderScheduleInfo(currentSchedule)}
              </div>
            </>
          ) : !generated ? (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <p className="flex items-center gap-2 font-body text-body-sm text-ink-secondary dark:text-night-muted">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${liveConflictCount > 0 ? 'bg-amber-500' : 'bg-primary'}`} aria-hidden="true" />
                  {liveConflictCount > 0
                    ? t('scheduler.livePreviewConflicts', { count: liveConflictCount })
                    : t('scheduler.livePreviewHint')}
                </p>
                <Button onClick={onViewCombinations}>{t('courses.viewCombinations')}</Button>
              </div>
              <ScheduleGrid slots={liveSlots} blockedTimes={blockedTimes} />
            </>
          ) : truncated ? null : (
            <EmptyState
              title={t('scheduler.noCombinations')}
              body={
                <ul className="mt-2 flex flex-col gap-1.5 text-left list-disc pl-5">
                  {noResultItems.map((item) => <li key={item}>{item}</li>)}
                </ul>
              }
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Button variant="outline" onClick={() => onGoToTab('courses')}>{t('scheduler.reviewCourses')}</Button>
                  {hasBlockedTimes && (
                    <Button variant="outline" onClick={() => onGoToTab('settings')}>{t('scheduler.reviewBlockedTimes')}</Button>
                  )}
                </div>
              }
            />
          )}
        </div>
      </div>

      {isExportOpen && (
        <ExportModal
          onClose={() => setIsExportOpen(false)}
          onSaveAsPDF={handleSaveAsPDF}
          onSaveAsImage={handleSaveAsImage}
          onSaveAsWallpaper={currentSchedule ? handleSaveAsWallpaper : undefined}
          onExportToCalendar={onExportToCalendar}
          onShareLink={handleShareLink}
        />
      )}

      {currentSchedule && (
        <div
          aria-hidden="true"
          style={{ position: 'fixed', left: '-99999px', top: 0, pointerEvents: 'none' }}
        >
          <WallpaperLayout ref={wallpaperRef} slots={currentSchedule.slots} />
        </div>
      )}
    </div>
  )
}
