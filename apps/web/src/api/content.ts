import { apiGet, apiSend } from './client'

export interface DepartmentEntry {
  slug: string
  colorVar: string
  displayOrder: number
}

export interface BenefitEntry {
  slug: string
  colorVar: string
  displayOrder: number
  linkUrl: string | null
  contactEmail: string | null
  highlightsEs: string[]
  highlightsEn: string[]
  // Optional display names; the UI falls back to the static i18n entry.
  nameEs: string | null
  nameEn: string | null
}

export interface BenefitCard {
  id: string
  categorySlug: string
  displayOrder: number
  titleEs: string
  titleEn: string
  summaryEs: string
  summaryEn: string
  imageUrl: string | null
  ctaUrl: string | null
  ctaLabelEs: string | null
  ctaLabelEn: string | null
  price: string | null
  bulletsEs: string[]
  bulletsEn: string[]
}

export function fetchDepartments(): Promise<DepartmentEntry[]> {
  return apiGet('/staff-departments')
}

export function fetchBenefits(): Promise<BenefitEntry[]> {
  return apiGet('/benefits')
}

// The slug becomes the category's primary key: lowercase letters, digits and
// single hyphens, 2-40 chars (the API answers 400 InvalidSlug otherwise and
// 409 if it is taken).
export function createBenefit(slug: string, payload: Omit<BenefitEntry, 'slug'>): Promise<BenefitEntry> {
  return apiSend('POST', `/benefits/${encodeURIComponent(slug)}`, payload)
}

// Deletes the category and, through the database cascade, all its cards.
export function deleteBenefit(slug: string): Promise<void> {
  return apiSend('DELETE', `/benefits/${encodeURIComponent(slug)}`)
}

export function updateBenefit(slug: string, payload: Omit<BenefitEntry, 'slug'>): Promise<BenefitEntry> {
  return apiSend('PUT', `/benefits/${slug}`, payload)
}

export function fetchBenefitCards(): Promise<BenefitCard[]> {
  return apiGet('/benefit-cards')
}

export function createBenefitCard(payload: Omit<BenefitCard, 'id'>): Promise<BenefitCard> {
  return apiSend('POST', '/benefit-cards', payload)
}

export function updateBenefitCard(id: string, payload: Omit<BenefitCard, 'id'>): Promise<BenefitCard> {
  return apiSend('PUT', `/benefit-cards/${id}`, payload)
}

export function deleteBenefitCard(id: string): Promise<void> {
  return apiSend('DELETE', `/benefit-cards/${id}`)
}
