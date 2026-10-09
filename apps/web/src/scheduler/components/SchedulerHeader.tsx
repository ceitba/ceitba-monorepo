import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { SCHEDULER_BASE } from '../paths'

// "← Combinador de horarios": the way back from the scheduler's secondary
// pages (saved, compare, share, a career). The section has no bar of its own
// under the app Navbar; its pages carry their context in their own header.
export function SchedulerBackLink({ to = SCHEDULER_BASE, state, label }: { to?: string; state?: unknown; label?: string }) {
  const { t } = useTranslation()
  return (
    <Link
      to={to}
      state={state}
      className="self-start inline-flex items-center gap-1.5 min-h-[44px] font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted hover:text-primary dark:hover:text-primary-300 transition-colors duration-150"
    >
      <span aria-hidden="true">←</span>
      {label ?? t('nav.scheduler')}
    </Link>
  )
}
