import type { TFunction } from 'i18next'
import type { ApunteSubject } from '../api/drive'

export interface PlanGroup {
  key: string
  label: string
  // Curricular year groups first, then one group per elective section.
  curricular: boolean
  subjects: ApunteSubject[]
}

// `year == null || year === 0` is non-curricular (electives, SAT, ...):
// never shown as "Año 0".
export function isCurricular(s: ApunteSubject): boolean {
  return s.year != null && s.year > 0
}

export function yearLabel(year: number, t: TFunction): string {
  return t(`apuntes.plan.years.${year}`, { defaultValue: t('apuntes.plan.yearN', { year }) })
}

export function semesterLabel(s: ApunteSubject, t: TFunction): string | null {
  return isCurricular(s) && s.semester != null && s.semester > 0 ? t('apuntes.plan.semester', { semester: s.semester }) : null
}

// Groups ?mine=true subjects keeping the API order inside each group.
export function groupPlanSubjects(list: ApunteSubject[], t: TFunction): PlanGroup[] {
  const years = new Map<number, PlanGroup>()
  const sections = new Map<string, PlanGroup>()
  for (const s of list) {
    if (isCurricular(s)) {
      const y = s.year as number
      if (!years.has(y)) years.set(y, { key: `y${y}`, label: yearLabel(y, t), curricular: true, subjects: [] })
      years.get(y)!.subjects.push(s)
    } else {
      const name = s.section?.trim() || ''
      if (!sections.has(name)) {
        sections.set(name, { key: `s:${name}`, label: name || t('apuntes.plan.otherSubjects'), curricular: false, subjects: [] })
      }
      sections.get(name)!.subjects.push(s)
    }
  }
  const yearGroups = [...years.entries()].sort((a, b) => a[0] - b[0]).map(([, g]) => g)
  // Named sections in first-seen order; the unnamed bucket last.
  const sectionGroups = [...sections.values()].sort((a, b) => Number(a.key === 's:') - Number(b.key === 's:'))
  return [...yearGroups, ...sectionGroups]
}
