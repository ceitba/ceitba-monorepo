import { createContext, useContext } from 'react'
import type { Theme } from '../store/prefsStore'

// Kept apart from ThemeProvider so ThemeContext.tsx only exports components
// (React Fast Refresh requirement).
interface ThemeContextValue {
  theme: Theme
  toggle: () => void
}

export const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useThemeContext() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useThemeContext must be used inside ThemeProvider')
  return ctx
}
