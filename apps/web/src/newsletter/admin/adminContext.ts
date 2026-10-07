import { useOutletContext } from 'react-router-dom'
import type { Organization } from '../types'

// What AdminLayout hands to every admin page through <Outlet context>: the
// organizations (fetched once for the whole admin area) and a slug → name
// lookup, so tables and headers never show a slug where a name exists.
export interface AdminOutletContext {
  orgs: Organization[]
  // Falls back to the slug only while the list is loading or if it failed.
  orgName: (slug: string | null | undefined) => string
}

export function useAdminContext(): AdminOutletContext {
  return useOutletContext<AdminOutletContext>()
}
