import { createContext, useContext } from 'react'

// The article open in the editor, for node views (```poll blocks) that need it.
export const EditorArticleContext = createContext<string | null>(null)

export const useEditorArticleId = () => useContext(EditorArticleContext)
