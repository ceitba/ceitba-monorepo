// The areas of Administración (/manage/:area), grouped by job in the rail.
// "review" (Para revisar) is the home: everything waiting on a decision.

export const AREAS = [
  'review',
  'newsletter', 'benefits',
  'people', 'organizations',
  'corrections', 'apuntes', 'wiki',
  'capabilities',
] as const

export type Area = (typeof AREAS)[number]

export const HOME_AREA: Area = 'review'

export type AreaGroup = 'content' | 'community' | 'academic' | 'system'

export const RAIL: { group: AreaGroup | null; areas: Area[] }[] = [
  { group: null, areas: ['review'] },
  { group: 'content', areas: ['newsletter', 'benefits'] },
  { group: 'community', areas: ['people', 'organizations'] },
  { group: 'academic', areas: ['corrections', 'apuntes', 'wiki'] },
  { group: 'system', areas: ['capabilities'] },
]

export function isArea(v: string | undefined | null): v is Area {
  return v != null && (AREAS as readonly string[]).includes(v)
}

export function areaPath(area: Area, rest = ''): string {
  return `/manage/${area}${rest}`
}

// The old tab strip kept the section in ?tab=; those links still land on
// the matching area. ?tab=staff was the yearly team roster editor, which is
// gone (nothing public shows the roster any more): it lands on the home.
export const LEGACY_TABS: Record<string, Area> = {
  staff: 'review',
  users: 'people',
  benefits: 'benefits',
  organizations: 'organizations',
  corrections: 'corrections',
  capabilities: 'capabilities',
  drive: 'apuntes',
  wikiAi: 'wiki',
}
