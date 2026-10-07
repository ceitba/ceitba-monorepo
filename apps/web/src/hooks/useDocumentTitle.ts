import { useEffect } from 'react'

// Sets the tab title while the calling component is mounted (index.html's
// "CEITBA" otherwise). Used by the sections to keep their own titles.
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    const previous = document.title
    document.title = title
    return () => { document.title = previous }
  }, [title])
}
