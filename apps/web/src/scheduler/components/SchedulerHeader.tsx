import { useState, useRef } from 'react'
import { NavLink, useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import useClickOutside from '../hooks/useClickOutside'
import { CAREERS, AVAILABLE_PLANS } from '../types/careers'
import { normalizePlanId } from '../utils/planUtils'
import { useAuth } from '@/hooks/useAuth'
import SectionHeader from '@/components/SectionHeader'
import { sectionLinkClass } from '@/components/sectionLinkClass'
import { SCHEDULER_BASE, schedulerPath } from '../paths'
import { buttonClass } from '@/components/ui'

interface SchedulerHeaderProps {
  // On a career page: the plan being shown, to offer the other plans.
  currentPlan?: string
}

// The scheduler's SectionHeader: current career and plan picker, plus the
// signed-in user's saved schedules.
export default function SchedulerHeader({ currentPlan }: SchedulerHeaderProps) {
  const params = useParams()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { profile } = useAuth()
  const careerCode = params.career ?? ''
  const careerName = careerCode ? (CAREERS[careerCode] || '') : ''
  const plans = careerCode ? (AVAILABLE_PLANS[careerCode] || []) : []
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  useClickOutside(dropdownRef as React.RefObject<HTMLElement>, () => setIsDropdownOpen(false))

  const handlePlanChange = (planId: string) => {
    setIsDropdownOpen(false)
    navigate(schedulerPath(`/${careerCode}?plan=${normalizePlanId(planId)}`))
  }

  const shortName = careerName.startsWith('Ingeniería')
    ? careerName.replace('Ingeniería', 'Ing.')
    : careerName.startsWith('Licenciatura')
    ? careerName.replace('Licenciatura', 'Lic.')
    : careerName

  return (
    <SectionHeader title={t('nav.scheduler')} subtitle={shortName || undefined} to={SCHEDULER_BASE}>
      {plans.length > 1 && currentPlan && (
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className={buttonClass({ variant: 'outline', size: 'sm' })}
            aria-expanded={isDropdownOpen}
            aria-haspopup="listbox"
          >
            <span>{currentPlan}</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {isDropdownOpen && (
            <div className="absolute right-0 z-50 mt-1 w-48 rounded-card bg-white dark:bg-night-surface border border-border dark:border-night-border shadow-card-hover" role="listbox">
              <div className="py-1">
                {plans.map(plan => (
                  <button
                    key={plan.id}
                    onClick={() => handlePlanChange(plan.id)}
                    role="option"
                    aria-selected={currentPlan === plan.id}
                    className={`block w-full min-h-[44px] text-left px-4 py-2.5 font-mono text-label uppercase tracking-widest transition-colors duration-100 ${
                      currentPlan === plan.id
                        ? 'bg-primary-50 dark:bg-primary-900 text-primary dark:text-primary-200 font-bold'
                        : 'text-ink-secondary dark:text-night-muted hover:bg-surface dark:hover:bg-night-bg'
                    }`}
                  >
                    {plan.id}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {profile && (
        <NavLink to={schedulerPath('/saved')} className={sectionLinkClass}>
          {t('auth.savedSchedules')}
        </NavLink>
      )}
    </SectionHeader>
  )
}
