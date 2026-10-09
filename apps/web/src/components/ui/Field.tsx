import { useId, type ReactNode } from 'react'

// Label + control + hint/error. Pass the control as a render prop so it gets
// the generated id and aria-describedby:
//   <Field label="Nombre" error={err}>{(p) => <input {...p} className={inputClass({ invalid: !!err })} />}</Field>
export function Field({
  label,
  hint,
  error,
  required = false,
  className = '',
  children,
}: {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  required?: boolean
  className?: string
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean; required?: boolean }) => ReactNode
}) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
        {label}
        {required && <span className="text-red-600 dark:text-red-400" aria-hidden="true"> *</span>}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined, required: required || undefined })}
      {hint && !error && (
        <p id={hintId} className="font-body text-label text-ink-secondary dark:text-night-muted">{hint}</p>
      )}
      {error && (
        <p id={errorId} className="font-body text-label text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  )
}
