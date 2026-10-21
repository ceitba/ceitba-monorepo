import { useEffect, useRef } from 'react'

// One entry per mounted hook instance, in the order they first got a title
// (so a detail page, which only knows its title after loading, sits above the
// section that mounted it), and the title from before the first one. Entries
// are updated in place when their title changes, never re-pushed, so an outer
// title changing while an inner one is mounted can't jump above it. Unmount
// cleanups run parent-first, so restoring a per-hook "previous" would leave the
// section's title behind after leaving it.
type TitleEntry = { title: string | null }
const titleStack: TitleEntry[] = []
let baseTitle = ''

// document.title = the innermost active (non-null) entry, else the original.
function applyTitle(): void {
  for (let i = titleStack.length - 1; i >= 0; i--) {
    const title = titleStack[i].title
    if (title !== null) {
      document.title = title
      return
    }
  }
  document.title = baseTitle
}

// Sets the tab title while the calling component is mounted (index.html's
// "CEITBA" otherwise). Used by the sections to keep their own titles. A null
// title leaves the title alone, for pages that only know theirs after loading:
// a child's effect runs before its parent's, so a page that set its title on
// mount would be overwritten by the section's; one that sets it after its data
// arrives (a later render) always wins.
export function useDocumentTitle(title: string | null): void {
  const entry = useRef<TitleEntry>({ title: null }).current
  // Leaving: drop the entry (also between StrictMode's simulated unmount and
  // remount; the effect below then registers it again).
  useEffect(() => () => {
    const i = titleStack.indexOf(entry)
    if (i >= 0) titleStack.splice(i, 1)
    applyTitle()
  }, [entry])
  useEffect(() => {
    entry.title = title
    if (title !== null && !titleStack.includes(entry)) {
      if (titleStack.length === 0) baseTitle = document.title
      titleStack.push(entry)
    }
    applyTitle()
  }, [entry, title])
}

// Sets <meta name="description"> while the calling component is mounted,
// restoring the previous content on unmount unless something else changed it
// since. A null/blank value leaves the existing description (index.html's site-wide one) alone.
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
      else if (meta.content === text) meta.content = previous
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
    const previous = link.getAttribute('href')
    link.setAttribute('href', href)
    return () => {
      if (created) link.remove()
      else if (link.getAttribute('href') === href) {
        if (previous === null) link.removeAttribute('href')
        else link.setAttribute('href', previous)
      }
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
