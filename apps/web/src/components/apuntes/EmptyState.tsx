import type { ReactNode } from 'react'
import { EmptyState as KitEmptyState } from '../ui'

// Deprecated: use @/components/ui (EmptyState). Thin wrapper kept only until
// the remaining callers migrate.
export default function EmptyState({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) {
  return <KitEmptyState title={title} body={body} action={action} />
}
