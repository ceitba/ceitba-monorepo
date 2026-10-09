import type { TFunction } from 'i18next'
import { CAREERS, EXCHANGE_CAREER } from '../types/careers'

// "Ingeniería en Informática · Plan S10-Rev18" for a saved schedule's
// career/plan; the career code is only shown when its name is unknown.
// (Career names are Spanish-only catalog data.)
export function careerPlanLabel(t: TFunction, careerId: string | null, plan: string | null): string {
  const career = careerId
    ? careerId === EXCHANGE_CAREER.id ? t('home.exchange.name') : (CAREERS[careerId] ?? careerId)
    : null
  const parts = [career, plan ? t('saved.planLabel', { plan }) : null].filter((p): p is string => !!p)
  return parts.length ? parts.join(' · ') : t('saved.noCareer')
}
