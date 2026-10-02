import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import es from './locales/es.json'
import en from './locales/en.json'

const savedLang = readLangFromStorage()

i18n
  .use(initReactI18next)
  .init({
    resources: {
      es: { translation: es },
      en: { translation: en },
    },
    lng: savedLang,
    fallbackLng: 'es',
    interpolation: { escapeValue: false },
  })

// Persist every language switch locally so anonymous visitors keep their
// choice across reloads. Server sync for signed-in users lives in
// ThemeContext (it needs the auth store, which this module must not import
// at init time). Inlined key instead of prefsStore.writeLocalLang for the
// same reason.
i18n.on('languageChanged', (lang) => {
  if (lang === 'es' || lang === 'en') {
    try { localStorage.setItem('prefs.lang', lang) } catch { /* storage blocked */ }
  }
})

function readLangFromStorage(): string {
  try {
    const v = localStorage.getItem('prefs.lang')
    return v === 'es' || v === 'en' ? v : 'es'
  } catch {
    return 'es'
  }
}

export default i18n
