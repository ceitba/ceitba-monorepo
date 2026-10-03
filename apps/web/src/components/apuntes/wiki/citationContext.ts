import { createContext, useContext } from 'react'

// Shared between WikiArticle (owner of the report dialog and the Fuentes
// panel) and the citation markers rendered inside the lazy Markdown chunk.
export interface CitationContextValue {
  // File ids by citation number (index + 1).
  order: string[]
  // Opens the page's report dialog preset to CONTENT_ERROR.
  reportPart: (comment: string) => void
}

export const CitationContext = createContext<CitationContextValue>({
  order: [],
  reportPart: () => {},
})

export function useCitations(): CitationContextValue {
  return useContext(CitationContext)
}

// Source hovered/focused in the Fuentes panel: its markers light up. Kept
// apart from CitationContext so hovering re-renders only the markers, not
// the whole Markdown body.
export const CitationHighlightContext = createContext<string | null>(null)

export function useCitationHighlight(): string | null {
  return useContext(CitationHighlightContext)
}
