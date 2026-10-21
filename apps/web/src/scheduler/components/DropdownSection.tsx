import { ReactNode, useId } from "react"

interface DropdownSectionProps {
  title: string
  children: ReactNode
  isOpen: boolean
  onToggle: () => void
}

const DropdownSection: React.FC<DropdownSectionProps> = ({
  title,
  children,
  isOpen,
  onToggle
}) => {
  const panelId = useId()
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={panelId}
        className="w-full min-h-[44px] flex items-center text-left font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted hover:text-ink-primary dark:hover:text-night-text transition-colors duration-150"
      >
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round"
          className={`mr-2 shrink-0 transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`}
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
        <span>{title}</span>
      </button>
      {isOpen && (
        <div id={panelId} className="ml-6">
          {children}
        </div>
      )}
    </div>
  )
}

export default DropdownSection
