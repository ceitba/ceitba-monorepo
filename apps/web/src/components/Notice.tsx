import type { ReactNode } from 'react'
import Alert from './ui/Alert'

// Deprecated: use @/components/ui (<Alert tone="success">). Thin wrapper kept
// only until the remaining callers migrate.
export default function Notice({
  children,
  onDismiss,
  className = '',
}: {
  children: ReactNode
  onDismiss?: () => void
  className?: string
}) {
  return <Alert tone="success" onDismiss={onDismiss} className={className}>{children}</Alert>
}
