import { apiSend } from '../api/client'
import { subscribe as onAuthChange, getCachedSession } from './authStore'

// Per-user preferences (theme + language) synced across all CEITBA SPAs.
// Source of truth:
//   logged-in   → server (PATCH /v1/me/preferences); localStorage is a cache.
//   anonymous   → localStorage only.
//
// On login the server values overwrite local. On any local change we write
// through to both. On logout we leave the cache alone — the user keeps the
// look-and-feel they had.
//
// localStorage keys are deliberately the same across SPAs (prefs.theme,
// prefs.lang) so a same-tab navigation between, say, the scheduler and
// CeitbaPage doesn't repaint with the wrong colors before /me hydrates.

export type Theme = 'light' | 'dark'
export type Lang  = 'es' | 'en'

const THEME_KEY = 'prefs.theme'
const LANG_KEY  = 'prefs.lang'

export function readLocalTheme(): Theme | null {
  const v = localStorage.getItem(THEME_KEY)
  return v === 'light' || v === 'dark' ? v : null
}

export function readLocalLang(): Lang | null {
  const v = localStorage.getItem(LANG_KEY)
  return v === 'es' || v === 'en' ? v : null
}

export function writeLocalTheme(theme: Theme): void {
  localStorage.setItem(THEME_KEY, theme)
}

export function writeLocalLang(lang: Lang): void {
  localStorage.setItem(LANG_KEY, lang)
}

// Push a single preference to the server. Best-effort: a network failure
// must not block the UI from changing locally, so we swallow errors. The
// user can retry implicitly by toggling again.
export async function syncPrefToServer(patch: { theme?: Theme; language?: Lang }): Promise<void> {
  if (getCachedSession() == null) return
  try {
    await apiSend('PATCH', '/me/preferences', patch)
  } catch {
    /* silent — local state is the source of truth for the active session */
  }
}

// Wires server-on-login: when the auth profile flips from null → present,
// the server's prefs (if any) overwrite local. Returns the unsubscribe.
export function bindAuthHydration(applyTheme: (t: Theme) => void, applyLang: (l: Lang) => void): () => void {
  let lastId: string | null = null
  return onAuthChange((profile) => {
    if (profile == null) { lastId = null; return }
    if (profile.id === lastId) return  // already applied for this session
    lastId = profile.id
    if (profile.theme === 'light' || profile.theme === 'dark') {
      writeLocalTheme(profile.theme)
      applyTheme(profile.theme)
    }
    // The /me payload field is `language` (the bound name from the API DTO).
    const lang = (profile as unknown as { language?: string }).language
    if (lang === 'es' || lang === 'en') {
      writeLocalLang(lang)
      applyLang(lang)
    }
  })
}
