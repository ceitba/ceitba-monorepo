const KEYS = { lang: 'prefs.lang', theme: 'prefs.theme' }

export function getLang() {
  return localStorage.getItem(KEYS.lang) || 'es'
}

export function setLang(lang) {
  localStorage.setItem(KEYS.lang, lang)
}

export function getTheme() {
  const stored = localStorage.getItem(KEYS.theme)
  if (stored) return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function setTheme(theme) {
  localStorage.setItem(KEYS.theme, theme)
  document.documentElement.classList.toggle('dark', theme === 'dark')
}
