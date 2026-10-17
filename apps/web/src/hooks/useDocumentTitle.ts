import { useEffect } from 'react'

// Sets the tab title while the calling component is mounted (index.html's
// "CEITBA" otherwise). Used by the sections to keep their own titles. A null
// title leaves the title alone, for pages that only know theirs after loading:
// a child's effect runs before its parent's, so a page that set its title on
// mount would be overwritten by the section's; one that sets it after its data
// arrives (a later render) always wins.
export function useDocumentTitle(title: string | null): void {
  useEffect(() => {
    if (title === null) return
    const previous = document.title
    document.title = title
    return () => { document.title = previous }
  }, [title])
}

// Sets <meta name="description"> while the calling component is mounted,
// restoring the previous content on unmount. A null/blank value leaves the
// existing description (index.html's site-wide one) alone.
export function useMetaDescription(description: string | null | undefined): void {
  useEffect(() => {
    const text = description?.trim()
    if (!text) return
    let meta = document.head.querySelector<HTMLMetaElement>('meta[name="description"]')
    const created = !meta
    if (!meta) {
      meta = document.createElement('meta')
      meta.name = 'description'
      document.head.appendChild(meta)
    }
    const previous = meta.content
    meta.content = text
    return () => {
      if (created) meta.remove()
      else meta.content = previous
    }
  }, [description])
}

// Adds <link rel="canonical"> while the calling component is mounted,
// restoring the previous href (or removing the tag) on unmount. A null href
// leaves the page without one, e.g. until the item has loaded.
export function useCanonical(href: string | null): void {
  useEffect(() => {
    if (!href) return
    let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    const created = !link
    if (!link) {
      link = document.createElement('link')
      link.rel = 'canonical'
      document.head.appendChild(link)
    }
    const previous = link.href
    link.href = href
    return () => {
      if (created) link.remove()
      else link.href = previous
    }
  }, [href])
}

// Adds <meta name="robots" content="noindex"> while `active` and mounted. The
// SPA answers HTTP 200 for any id, so a not-found page would otherwise be
// indexed as a soft 404.
export function useNoIndex(active: boolean): void {
  useEffect(() => {
    if (!active) return
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex'
    document.head.appendChild(meta)
    return () => meta.remove()
  }, [active])
}
