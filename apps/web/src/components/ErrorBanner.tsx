import type { ReactNode } from 'react'
import Alert from './ui/Alert'

// Deprecated: use @/components/ui (<Alert tone="error">). Thin wrapper kept
// only until the remaining callers migrate.
export default function ErrorBanner({
  children,
  onDismiss,
  className = '',
}: {
  children: ReactNode
  onDismiss?: () => void
  className?: string
}) {
  return <Alert tone="error" onDismiss={onDismiss} className={className}>{children}</Alert>
}
