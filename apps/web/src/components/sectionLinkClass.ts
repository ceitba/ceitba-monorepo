// Section sub-navigation (SectionHeader's right-hand side): links that look
// exactly like the kit's Tabs, since they do the same job with URLs.
export function sectionLinkClass({ isActive }: { isActive: boolean }): string {
  return `min-h-[44px] inline-flex items-center font-mono text-label uppercase tracking-widest border-b-2 transition-colors duration-150 ${
    isActive
      ? 'text-primary dark:text-primary-300 font-bold border-primary dark:border-primary-300'
      : 'text-ink-secondary dark:text-night-muted hover:text-ink-primary dark:hover:text-night-text border-transparent'
  }`
}
