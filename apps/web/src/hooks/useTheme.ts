import { useEffect, useState } from 'react'
import { readLocalTheme, syncPrefToServer, writeLocalTheme, type Theme } from '../store/prefsStore'

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = readLocalTheme()
    if (saved) return saved
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
    writeLocalTheme(theme)
  }, [theme])

  const toggle = () => {
    setTheme((prev) => {
      const next: Theme = prev === 'light' ? 'dark' : 'light'
      void syncPrefToServer({ theme: next })
      return next
    })
  }

  // External writes (auth-hydration callback) bypass the toggle path.
  const applyExternal = (next: Theme) => setTheme(next)

  return { theme, toggle, applyExternal }
}
