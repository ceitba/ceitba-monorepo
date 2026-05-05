import { createContext, useContext, useEffect, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../hooks/useTheme'
import { bindAuthHydration, syncPrefToServer, writeLocalLang, type Lang, type Theme } from '../store/prefsStore'

interface ThemeContextValue {
  theme: Theme
  toggle: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { theme, toggle, applyExternal } = useTheme()
  const { i18n } = useTranslation()

  // Bind auth hydration once at provider mount: when the user logs in, the
  // server-side theme/language overwrite local state. When they log out we
  // intentionally do nothing — the cache stays.
  useEffect(() => {
    return bindAuthHydration(
      (next) => applyExternal(next),
      (lang) => {
        if (i18n.language !== lang) i18n.changeLanguage(lang)
        writeLocalLang(lang)
      },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Mirror local-only language changes through the server.
  useEffect(() => {
    const handler = (lang: string) => {
      void syncPrefToServer({ language: lang as Lang })
    }
    i18n.on('languageChanged', handler)
    return () => { i18n.off('languageChanged', handler) }
  }, [i18n])

  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>
}

export function useThemeContext() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useThemeContext must be used inside ThemeProvider')
  return ctx
}
