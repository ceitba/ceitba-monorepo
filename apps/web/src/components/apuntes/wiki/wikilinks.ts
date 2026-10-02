import type { KbLink, KbSource } from '../../../api/kb'

// Wikilinks → ordinary Markdown links with private schemes, rendered by
// WikiMarkdown's <a> override:
//   [[slug]] [[slug|text]] [[61.12/slug|text]] [[61.12|text]] → [text](wiki:<raw>)
//   [[file:<uuid>]] [[file:<uuid>|text]]                     → [text](cite:<uuid>)
// Code spans and fenced code blocks are left untouched.

export const WIKI_SCHEME = 'wiki:'
export const CITE_SCHEME = 'cite:'

const WIKILINK = /\[\[([^\]|\n]+?)(?:\|([^\]\n]+?))?\]\]/g

function escapeLinkText(text: string): string {
  return text.replace(/([\\[\]])/g, '\\$1')
}

function replaceInText(text: string, links: Map<string, KbLink>, sources: KbSource[]): string {
  return text.replace(WIKILINK, (_m, rawTarget: string, label?: string) => {
    const target = rawTarget.trim()
    if (target.toLowerCase().startsWith('file:')) {
      const id = target.slice(5).trim()
      const index = sources.findIndex((s) => s.id === id)
      const shown = label?.trim() || (index >= 0 ? String(index + 1) : '?')
      return `[${escapeLinkText(shown)}](${CITE_SCHEME}${encodeURIComponent(id)})`
    }
    const link = links.get(target)
    const shown = label?.trim() || link?.title || target
    return `[${escapeLinkText(shown)}](${WIKI_SCHEME}${encodeURIComponent(target)})`
  })
}

// Splits on fenced blocks (``` / ~~~) and inline code spans so wikilinks
// inside code stay literal.
export function preprocessWikilinks(markdown: string, links: KbLink[], sources: KbSource[]): string {
  const map = new Map(links.map((l) => [l.raw, l]))
  const out: string[] = []
  const lines = markdown.split('\n')
  let fence: string | null = null
  for (const line of lines) {
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
    // Alternate between text and `code` segments.
    const parts = line.split(/(`+[^`]*`+)/)
    out.push(parts.map((p, i) => (i % 2 === 1 ? p : replaceInText(p, map, sources))).join(''))
  }
  return out.join('\n')
}
