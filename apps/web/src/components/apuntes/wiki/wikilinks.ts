import type { KbLink, KbSource } from '../../../api/kb'

// Wikilinks → ordinary Markdown links with private schemes, rendered by
// WikiMarkdown's <a> override:
//   [[slug]] [[slug|text]] [[61.12/slug|text]] [[61.12|text]] → [text](wiki:<raw>)
//   [[file:<uuid>]] [[file:<uuid>|label]] → [n](cite:<uuid> "label")
// Citations are numbered by first appearance (the same file keeps its
// number), and runs of adjacent citations are glued together so they read
// "[1][2]". Code spans and fenced code blocks are left untouched.

export const WIKI_SCHEME = 'wiki:'
export const CITE_SCHEME = 'cite:'

const WIKILINK = /\[\[([^\]|\n]+?)(?:\|([^\]\n]+?))?\]\]/g
const CITE_RUN_GAP = /(\[\[file:[^\]\n]+\]\])\s+(?=\[\[file:)/gi
const FILE_TARGET = /\[\[file:([^\]|\n]+?)(?:\|[^\]\n]+?)?\]\]/gi

function escapeLinkText(text: string): string {
  return text.replace(/([\\[\]])/g, '\\$1')
}

function escapeTitle(text: string): string {
  return text.replace(/(["\\])/g, '\\$1')
}

// Calls fn on every non-code segment of the markdown (fences and inline
// code spans are passed through unchanged).
function mapText(markdown: string, fn: (text: string) => string): string {
  const out: string[] = []
  let fence: string | null = null
  for (const line of markdown.split('\n')) {
    const fenceMatch = /^\s*(```|~~~)/.exec(line)
    if (fence) {
      out.push(line)
      if (fenceMatch && fenceMatch[1] === fence) fence = null
      continue
    }
    if (fenceMatch) {
      fence = fenceMatch[1]
      out.push(line)
      continue
    }
    const parts = line.split(/(`+[^`]*`+)/)
    out.push(parts.map((p, i) => (i % 2 === 1 ? p : fn(p))).join(''))
  }
  return out.join('\n')
}

// Citation numbering for a page: cited files in order of first appearance,
// then any remaining sources (so the Fuentes panel numbers match the text).
export function citationOrder(markdown: string, sources: KbSource[]): string[] {
  const order: string[] = []
  mapText(markdown ?? '', (text) => {
    for (const m of text.matchAll(FILE_TARGET)) {
      const id = m[1].trim()
      if (!order.includes(id)) order.push(id)
    }
    return text
  })
  for (const s of sources) if (!order.includes(s.id)) order.push(s.id)
  return order
}

export function preprocessWikilinks(markdown: string, links: KbLink[], order: string[]): string {
  const map = new Map(links.map((l) => [l.raw, l]))
  return mapText(markdown ?? '', (text) =>
    text.replace(CITE_RUN_GAP, '$1').replace(WIKILINK, (_m, rawTarget: string, label?: string) => {
      const target = rawTarget.trim()
      if (target.toLowerCase().startsWith('file:')) {
        const id = target.slice(5).trim()
        const n = order.indexOf(id) + 1
        const title = label?.trim() ? ` "${escapeTitle(label.trim())}"` : ''
        return `[${n > 0 ? n : '?'}](${CITE_SCHEME}${encodeURIComponent(id)}${title})`
      }
      const link = map.get(target)
      const shown = label?.trim() || link?.title || target
      return `[${escapeLinkText(shown)}](${WIKI_SCHEME}${encodeURIComponent(target)})`
    }),
  )
}

// Heading text per line of the (preprocessed) markdown: for each line, the
// nearest heading at or above it, so a citation can name its section.
export function sectionByLine(markdown: string): (string | null)[] {
  const result: (string | null)[] = [null]
  let current: string | null = null
  let fence: string | null = null
  for (const line of markdown.split('\n')) {
    const fenceMatch = /^\s*(```|~~~)/.exec(line)
    if (fence) {
      if (fenceMatch && fenceMatch[1] === fence) fence = null
    } else if (fenceMatch) {
      fence = fenceMatch[1]
    } else {
      const h = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line)
      if (h) current = plainHeading(h[1])
    }
    result.push(current) // index = 1-based line number
  }
  return result
}

function plainHeading(md: string): string {
  return md
    .replace(/\[([^\]]*)\]\((?:cite:)[^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .replace(/\\([\\[\]])/g, '$1')
    .trim()
}
