import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { buttonClass, iconButtonClass, type ButtonSize, type ButtonTextCase, type ButtonVariant } from './buttonClass'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  block?: boolean
  // Shows `loadingLabel` (or "…") and disables the button while an action runs.
  loading?: boolean
  loadingLabel?: string
  // A toggle button: sets aria-pressed and, on `outline`, the selected chip look.
  pressed?: boolean
  // `text` for labels that are content (names), not commands; default `label`.
  textCase?: ButtonTextCase
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, block, loading = false, loadingLabel, pressed, textCase, className, disabled, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-pressed={pressed}
      className={buttonClass({ variant, size, block, pressed, textCase, className })}
      {...rest}
    >
      {loading ? (loadingLabel ?? '…') : children}
    </button>
  )
})

export default Button

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  'aria-label': string
  size?: ButtonSize
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { size, className, type = 'button', ...rest },
  ref,
) {
  return <button ref={ref} type={type} className={iconButtonClass({ size, className })} {...rest} />
})

// The × glyph used by every close/dismiss/remove control.
export function CloseIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  )
}
