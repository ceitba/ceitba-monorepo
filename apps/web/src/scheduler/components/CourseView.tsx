import React, { useState } from "react"
import { useTranslation } from "react-i18next"
import SearchBox from "./SearchBox"
import { type Subject } from "../hooks/useSubjects"
import SelectedCoursesList from "./SelectedCoursesList"
import AvailableCoursesList from "./AvailableCoursesList"
import { useParams } from "react-router-dom"
import type { ConflictReport } from "../services/conflicts"
import { Button, ErrorState, LoadingRegion, Modal, Skeleton } from "@/components/ui"

interface SelectedCourse extends Subject {
  selectedCommissions: string[]
}

interface CourseViewProps {
  subjects: Subject[]
  loading: boolean
  error: boolean
  onRetry: () => void
  selectedCourses: SelectedCourse[]
  conflictReport: ConflictReport
  onCommissionSelect: (course: Subject) => void
  onAddCourse: (course: Subject, commissions: string[]) => void
  onRemoveCourse: (courseId: string) => void
  onReorderCourses: (courses: SelectedCourse[]) => void
  // Generates the combinations and opens the Calendario tab.
  onViewCombinations: () => void
}

const NoScheduleModal: React.FC<{ onClose: () => void; subjectName: string }> = ({ onClose, subjectName }) => {
  const { t } = useTranslation()
  return (
    <Modal
      onClose={onClose}
      title={t('courses.noScheduleTitle')}
      size="sm"
      footer={<Button onClick={onClose}>{t('courses.understood')}</Button>}
    >
      <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">
        {t('courses.noScheduleMessage', { name: subjectName })}
      </p>
    </Modal>
  )
}

// Catalog-shaped placeholder: search box, then the two columns of cards.
function CourseViewSkeleton() {
  return (
    <LoadingRegion className="max-w-7xl mx-auto">
      <Skeleton className="h-11 w-full" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4" aria-hidden="true">
        <Skeleton className="hidden md:block h-64 rounded-card" />
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-card" />)}
        </div>
      </div>
    </LoadingRegion>
  )
}

const CourseView: React.FC<CourseViewProps> = ({
  subjects,
  loading,
  error,
  onRetry,
  selectedCourses,
  conflictReport,
  onCommissionSelect,
  onAddCourse,
  onRemoveCourse,
  onReorderCourses,
  onViewCombinations,
}) => {
  const { t } = useTranslation()
  const { career } = useParams()
  const isExchange = career === "X"
  const totalCredits = selectedCourses.reduce(
    (sum, course) => sum + course.credits,
    0
  )
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  // Name of the subject whose "no schedules" notice is open.
  const [noScheduleSubject, setNoScheduleSubject] = useState<string | null>(null)

  const subjectsByYear = isExchange
    ? {
        1: {
          year: t('courses.available'),
          subjects: { "1": subjects, "2": [] },
        },
      }
    : subjects.reduce(
        (acc, subject) => {
          const year = subject.year || 0
          if (!acc[year]) {
            acc[year] = {
              year: year === 0 ? t('courses.electives').toUpperCase() : t('courses.year', { count: year, ordinal: true }),
              subjects: { "1": [], "2": [] },
            }
          }

          const quarter = subject.semester?.toString() || "1"
          if (quarter === "1" || quarter === "2") {
            acc[year].subjects[quarter]?.push(subject)
          } else {
            if (!acc[year].subjects[subject.section]) {
              acc[year].subjects[subject.section] = []
            }
            acc[year].subjects[subject.section].push(subject)
          }

          return acc
        },
        {} as Record<number, { year: string; subjects: { "1": Subject[]; "2": Subject[]; [category: string]: Subject[] } }>
      )

  const sortedSubjectsByYear = isExchange
    ? subjectsByYear
    : Object.entries(subjectsByYear)
        .sort(([yearA], [yearB]) => {
          const a = parseInt(yearA)
          const b = parseInt(yearB)
          if (a === 0) return 1
          if (b === 0) return -1
          return a - b
        })
        .reduce((acc, [year, data]) => {
          const displayYear = parseInt(year) === 0 ? 6 : parseInt(year)
          acc[displayYear] = data
          return acc
        }, {} as Record<number, (typeof subjectsByYear)[number]>)

  const handleSubjectSelect = (subject: Subject) => {
    const hasNoSchedules =
      !subject.commissions?.length ||
      subject.commissions.every((comm) => !comm.schedule?.length)

    if (hasNoSchedules) {
      setNoScheduleSubject(subject.name)
      return
    }

    if (selectedCourses.some((c) => c.subject_id === subject.subject_id)) {
      onRemoveCourse(subject.subject_id)
      return
    }

    const validCommissions = subject.commissions.filter(
      (comm) => comm.schedule?.length > 0
    )

    if (validCommissions.length === 1) {
      onAddCourse(subject, [validCommissions[0].name])
      return
    }

    onCommissionSelect(subject)
  }

  if (loading) return <CourseViewSkeleton />

  if (error) {
    return <ErrorState title={t('courses.loadFailedTitle')} message={t('courses.loadFailed')} onRetry={onRetry} />
  }

  const summary = t('courses.selectedSummary', { count: selectedCourses.length, credits: totalCredits })

  return (
    <div className="max-w-7xl mx-auto">
      <SearchBox subjects={subjects} onSelectSubject={handleSubjectSelect} />
      {/* Desktop Layout */}
      <div className="hidden md:grid md:grid-cols-2 md:gap-4 mt-4">
        <div>
          <div className="sticky top-18 rounded-card p-4 bg-surface dark:bg-night-surface border border-border dark:border-night-border">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-body font-semibold text-body text-ink-primary dark:text-night-text">
                {t('courses.selected')}
              </h2>
              {totalCredits > 0 && (
                <div className="font-mono text-label text-ink-secondary dark:text-night-muted">
                  {t('courses.creditCount', { count: totalCredits })}
                </div>
              )}
            </div>
            <SelectedCoursesList
              courses={selectedCourses}
              onRemove={onRemoveCourse}
              onReorder={onReorderCourses}
              conflictReport={conflictReport}
            />
          </div>
        </div>
        <div className="overflow-y-auto">
          <AvailableCoursesList
            courses={sortedSubjectsByYear}
            selectedCourses={selectedCourses}
            onCourseClick={handleSubjectSelect}
            isExchange={isExchange}
          />
        </div>
      </div>

      {/* Mobile Layout */}
      <div className="md:hidden">
        {selectedCourses.length > 0 && (
          <div className="bg-white dark:bg-night-surface border border-border dark:border-night-border rounded-card mt-4">
            <button
              type="button"
              onClick={() => setIsPreviewOpen(!isPreviewOpen)}
              aria-expanded={isPreviewOpen}
              className="w-full flex items-center justify-between px-4 border-b border-border dark:border-night-border h-20"
            >
              <div className="flex flex-col items-start justify-between w-full">
                <div className="font-body font-semibold text-body text-ink-primary dark:text-night-text">
                  {t('courses.selected')}
                </div>
                <div className="font-mono text-label text-ink-secondary dark:text-night-muted">
                  {summary}
                </div>
              </div>
              <div>
                <svg
                  width="18" height="18" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                  className={`text-ink-secondary dark:text-night-muted transition-transform duration-150 ${isPreviewOpen ? 'rotate-180' : ''}`}
                  aria-hidden="true"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </div>
            </button>

            {isPreviewOpen && (
              <div className="border-b border-border dark:border-night-border p-3">
                <SelectedCoursesList
                  courses={selectedCourses}
                  onRemove={onRemoveCourse}
                  onReorder={onReorderCourses}
                  conflictReport={conflictReport}
                />
              </div>
            )}
          </div>
        )}
        <div className="mt-4">
          <AvailableCoursesList
            courses={sortedSubjectsByYear}
            selectedCourses={selectedCourses}
            onCourseClick={handleSubjectSelect}
            isExchange={isExchange}
          />
        </div>
      </div>

      {/* The main step once subjects are picked; sticks to the bottom of
          the screen while scrolling the catalog. */}
      {selectedCourses.length > 0 && (
        <div className="sticky bottom-4 z-20 mt-6 flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface shadow-card-hover">
          <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">
            {summary}
            {conflictReport.totalConflicts > 0 && (
              <> · <span className="text-amber-800 dark:text-amber-300">{t('courses.conflictCount', { count: conflictReport.totalConflicts })}</span></>
            )}
          </p>
          <Button onClick={onViewCombinations}>{t('courses.viewCombinations')}</Button>
        </div>
      )}

      {noScheduleSubject !== null && (
        <NoScheduleModal onClose={() => setNoScheduleSubject(null)} subjectName={noScheduleSubject} />
      )}
    </div>
  )
}

export default CourseView
