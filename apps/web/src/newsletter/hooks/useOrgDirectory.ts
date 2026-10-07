import { useCallback, useEffect, useState } from 'react'
import { fetchOrganizations } from '../api/organizations'
import type { AdminOutletContext } from '../admin/adminContext'
import type { Organization } from '../types'

// Every organization, fetched once per signed-in area, plus a slug → name
// lookup.
export function useOrgDirectory(): Pick<AdminOutletContext, 'orgs' | 'orgName'> {
  const [orgs, setOrgs] = useState<Organization[]>([])

  useEffect(() => {
    let active = true
    fetchOrganizations()
      .then(({ data }) => { if (active) setOrgs(data ?? []) })
      // Names are a nicety on top of slugs; pages still work without them.
      .catch((err: unknown) => console.error('newsletter: organizations', err))
    return () => { active = false }
  }, [])

  const orgName = useCallback(
    (slug: string | null | undefined) => (slug ? orgs.find((o) => o.slug === slug)?.name ?? slug : ''),
    [orgs],
  )
  return { orgs, orgName }
}
