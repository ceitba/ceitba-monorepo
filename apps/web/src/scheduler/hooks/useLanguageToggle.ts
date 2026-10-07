import { useTranslation } from 'react-i18next'

// ES <-> EN toggle for the headers. ThemeProvider persists the change to
// prefs.lang and the user's profile.
export function useLanguageToggle() {
  const { i18n } = useTranslation()
  return () => { void i18n.changeLanguage(i18n.language === 'es' ? 'en' : 'es') }
}
