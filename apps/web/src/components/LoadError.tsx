import { ErrorState } from './ui'

// Deprecated: use @/components/ui (<ErrorState onRetry>). Thin wrapper kept
// only until the remaining callers migrate.
export default function LoadError({ onRetry }: { onRetry: () => void }) {
  return <ErrorState onRetry={onRetry} />
}
