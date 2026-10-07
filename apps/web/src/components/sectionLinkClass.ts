// Underlined tab-style link for SectionHeader's right-hand side.
export function sectionLinkClass({ isActive }: { isActive: boolean }): string {
  return `min-h-[36px] inline-flex items-center font-body text-body-sm font-semibold border-b-2 transition-colors duration-150 ${
    isActive
      ? 'text-primary border-accent'
      : 'text-ink-secondary dark:text-night-muted hover:text-primary border-transparent'
  }`
}
