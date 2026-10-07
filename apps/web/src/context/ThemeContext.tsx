import { useEffect, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../hooks/useTheme'
import { bindAuthHydration, syncPrefToServer, writeLocalLang, type Lang } from '../store/prefsStore'
import { ThemeContext } from './useThemeContext'

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { theme, toggle, applyExternal } = useTheme()
  const { i18n } = useTranslation()
  // Language the server is known to hold for the signed-in user. Hydration
  // sets it before switching i18n, so the languageChanged handler below
  // doesn't PATCH back the value it just received.
  const serverLangRef = useRef<Lang | null>(null)

  // Bind auth hydration once at provider mount (applyExternal and i18n are
  // both stable): when the user logs in, the server-side theme/language
  // overwrite local state. When they log out we intentionally do nothing —
  // the cache stays.
  useEffect(() => {
    return bindAuthHydration(
      (next) => applyExternal(next),
      (lang) => {
        serverLangRef.current = lang
        if (i18n.language !== lang) i18n.changeLanguage(lang)
        writeLocalLang(lang)
      },
    )
  }, [applyExternal, i18n])

  // Mirror user-initiated language changes to the server (localStorage is
  // handled by the languageChanged listener in src/i18n.ts).
  useEffect(() => {
    const handler = (lang: string) => {
      if (lang !== 'es' && lang !== 'en') return
      if (lang === serverLangRef.current) return
      serverLangRef.current = lang
      void syncPrefToServer({ language: lang })
    }
    i18n.on('languageChanged', handler)
    return () => { i18n.off('languageChanged', handler) }
  }, [i18n])

  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>
}
