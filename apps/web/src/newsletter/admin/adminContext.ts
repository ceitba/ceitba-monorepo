import { useOutletContext } from 'react-router-dom'
import type { Organization } from '../types'

// What the area layouts (Mis publicaciones and the staff admin) hand to
// every page through <Outlet context>: the organizations (fetched once for
// the whole area) and a slug → name lookup, so tables and headers never show
// a slug where a name exists.
export interface AdminOutletContext {
  orgs: Organization[]
  // Falls back to the slug only while the list is loading or if it failed.
  orgName: (slug: string | null | undefined) => string
  // Staff admin only: reloads the articles of the shared review queue (the
  // Revisión tab and the rail count both read it).
  refreshPending?: () => void
}

export function useAdminContext(): AdminOutletContext {
  return useOutletContext<AdminOutletContext>()
}
