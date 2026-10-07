import type { TFunction } from 'i18next'
import i18n from 'i18next'
import { ApiError } from '../../api/client'

// Student-facing copy for a failed Apuntes call: the translated message for
// a known ApiError code (apuntes.errors.<CODE>), otherwise a generic one.
// Never returns raw server text; the original error goes to the console.
// (utils/apuntes.ts apuntesErrorMessage falls back to e.message; prefer this.)
export function apuntesErrorCopy(e: unknown, t: TFunction): string {
  if (e instanceof ApiError && e.code && i18n.exists(`apuntes.errors.${e.code}`)) {
    return t(`apuntes.errors.${e.code}`)
  }
  console.error(e)
  return t('errors.somethingWrong')
}
