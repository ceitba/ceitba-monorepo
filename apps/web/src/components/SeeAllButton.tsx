// "Ver todo →" link-style button that heads a home preview section and jumps
// to the full tab.
export default function SeeAllButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 min-h-[44px] font-mono text-label uppercase tracking-widest text-primary dark:text-primary-300 font-bold hover:underline underline-offset-4 self-start sm:self-auto"
    >
      {label}
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <line x1="5" y1="12" x2="19" y2="12" />
        <polyline points="12 5 19 12 12 19" />
      </svg>
    </button>
  )
}
