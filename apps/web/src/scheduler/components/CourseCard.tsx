import { useTranslation } from "react-i18next"
import { Badge } from "@/components/ui"
import { type Subject } from "../hooks/useSubjects"

interface CourseCardProps {
  course: Subject
  isSelected: boolean
  onClick: () => void
}

// One subject of the catalog. Pressing it adds the subject (or opens the
// commission picker); pressing a selected one removes it.
const CourseCard: React.FC<CourseCardProps> = ({ course, isSelected, onClick }) => {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isSelected}
      className={`w-full min-h-[44px] flex items-center justify-between p-3 rounded-card border text-left transition-shadow duration-200 group ${
        isSelected
          ? 'border-primary bg-primary-50 dark:border-primary-400 dark:bg-primary-900'
          : 'border-border dark:border-night-border bg-white dark:bg-night-surface shadow-card hover:shadow-card-hover'
      }`}
    >
      <span className="flex flex-row gap-2 min-w-0">
        <span className="font-mono text-label text-ink-secondary dark:text-night-muted flex-shrink-0">
          ({course.subject_id})
        </span>
        <span className="flex flex-col min-w-0">
          <span className="font-body text-body-sm text-ink-primary dark:text-night-text truncate">
            {course.name}
          </span>
          <span className="font-mono text-label text-ink-secondary dark:text-night-muted">
            {t('courses.creditCount', { count: course.credits })}
          </span>
          {course.past_term && (
            <Badge tone="warning" className="self-start mt-1" title={t('courses.pastTermHint')}>
              {t('courses.pastTerm')}
            </Badge>
          )}
        </span>
      </span>

      {/* State is conveyed by aria-pressed; the verb is for sighted users. */}
      <span aria-hidden="true" className="flex-shrink-0 ml-2 inline-flex items-center gap-1.5 font-mono text-label uppercase tracking-widest">
        {isSelected ? (
          <span className="text-primary dark:text-primary-300 inline-flex items-center gap-1.5">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
            {t('courses.remove')}
          </span>
        ) : (
          <span className="text-ink-secondary dark:text-night-muted group-hover:text-primary dark:group-hover:text-primary-300 inline-flex items-center gap-1.5 transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {t('courses.add')}
          </span>
        )}
      </span>
    </button>
  )
}

export default CourseCard
