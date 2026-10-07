import type { TFunction } from 'i18next'
import { ApiError } from '../../api/client'

// Human copy for a failed /manage request. Known API error codes get their
// own text under manage.errors.codes.<CODE>; anything else falls back to a
// message by HTTP status, then to a generic one. The raw server text is
// only logged, never shown.
export function adminErrorMessage(e: unknown, t: TFunction): string {
  console.error(e)
  if (e instanceof ApiError) {
    if (e.code === 'NETWORK_ERROR') return t('manage.errors.network')
    const byStatus =
      e.status === 401 ? t('manage.errors.unauthorized')
      : e.status === 403 ? t('manage.errors.forbidden')
      : e.status === 404 ? t('manage.errors.notFound')
      : e.status === 409 ? t('manage.errors.conflict')
      : e.status === 400 || e.status === 422 ? t('manage.errors.invalid')
      : e.status === 429 ? t('manage.errors.tooMany')
      : t('manage.errors.generic')
    return t(`manage.errors.codes.${e.code}`, { defaultValue: byStatus })
  }
  return t('manage.errors.generic')
}

// Same, for the Apuntes/Wiki IA endpoints: their error codes have copy under
// apuntes.errors.<CODE> (loaded by i18nApuntes); anything else goes through
// adminErrorMessage.
export function apuntesAdminErrorMessage(e: unknown, t: TFunction): string {
  const fallback = adminErrorMessage(e, t)
  return e instanceof ApiError ? t(`apuntes.errors.${e.code}`, { defaultValue: fallback }) : fallback
}
