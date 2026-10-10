// One input look for every form on the site. 44px tall, white field on the
// off-white page, primary border on focus, red border when invalid.
const CONTROL =
  'w-full min-h-[44px] px-3 py-2 rounded-sm border bg-white dark:bg-night-surface font-body text-body-sm ' +
  'text-ink-primary dark:text-night-text placeholder:text-ink-secondary dark:placeholder:text-night-muted ' +
  'focus:outline-none focus:ring-1 transition-colors duration-150 disabled:opacity-60 disabled:cursor-not-allowed'

const OK = 'border-border dark:border-night-border focus:border-primary focus:ring-primary/30'
const BAD = 'border-red-400 dark:border-red-500 focus:border-red-500 focus:ring-red-300/40'

export function inputClass({ invalid = false, className = '' }: { invalid?: boolean; className?: string } = {}) {
  return [CONTROL, invalid ? BAD : OK, className].filter(Boolean).join(' ')
}

export const selectClass = (opts: { invalid?: boolean; className?: string } = {}) =>
  inputClass({ ...opts, className: `pr-8 ${opts.className ?? ''}` })

export const textareaClass = (opts: { invalid?: boolean; className?: string } = {}) =>
  inputClass({ ...opts, className: `min-h-[96px] leading-relaxed ${opts.className ?? ''}` })
