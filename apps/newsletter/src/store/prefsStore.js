import { apiRequest } from '../api/client'
import { getCachedSession } from './authStore'

const KEYS = { lang: 'prefs.lang', theme: 'prefs.theme' }

export function getLang() {
  return localStorage.getItem(KEYS.lang) || 'es'
}

export function setLang(lang) {
  localStorage.setItem(KEYS.lang, lang)
  void syncPrefToServer({ language: lang })
}

export function getTheme() {
  const stored = localStorage.getItem(KEYS.theme)
  if (stored) return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function setTheme(theme) {
  localStorage.setItem(KEYS.theme, theme)
  document.documentElement.classList.toggle('dark', theme === 'dark')
  void syncPrefToServer({ theme })
}

// Best-effort PATCH — local state has already updated, network failure is
// swallowed because the user can retry by toggling again.
async function syncPrefToServer(patch) {
  if (getCachedSession() == null) return
  try { await apiRequest('PATCH', '/me/preferences', patch) } catch { /* ignore */ }
}
