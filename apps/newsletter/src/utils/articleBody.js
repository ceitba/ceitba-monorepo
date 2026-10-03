// Article bodies are Markdown (GFM, plus ```mermaid fences). The API still
// stores `body` as a list of strings: the editor saves one Markdown document
// as a single element, and articles written with the old one-textarea-per-
// paragraph editor are a list of plain paragraphs. Joining with a blank line
// reads both the same way — each old paragraph becomes a Markdown paragraph.
export function bodyToMarkdown(body) {
  if (!Array.isArray(body)) return typeof body === 'string' ? body : ''
  return body.filter((p) => typeof p === 'string' && p.trim()).join('\n\n')
}

// Markdown → roughly what a reader reads: no fences, images, link targets or
// syntax characters. Only used for counting words and building fallbacks.
export function markdownToPlainText(markdown) {
  return (markdown ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/[*_~`|]/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function countWords(text) {
  const trimmed = (text ?? '').trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

const WORDS_PER_MINUTE = 200

// "N min", never less than one minute. Matches the format editors typed by
// hand ("4 min"), which the article page shows as-is.
export function readingTimeFor(markdown) {
  const minutes = Math.max(1, Math.round(countWords(markdownToPlainText(markdown)) / WORDS_PER_MINUTE))
  return `${minutes} min`
}

// Heuristic for plain-text pastes (Markdown copied from a terminal, an .md
// file, a chat that only put text on the clipboard): headings, lists,
// quotes, fences, bold or links. A single line of prose doesn't qualify.
const MARKDOWN_HINTS = [
  /^\s{0,3}#{1,6}\s+\S/m,
  /^\s{0,3}[-*+]\s+\S/m,
  /^\s{0,3}\d+[.)]\s+\S/m,
  /^\s{0,3}>\s?\S/m,
  /^\s{0,3}```/m,
  /\*\*[^*\n]+\*\*/,
  /\[[^\]\n]+\]\([^)\s]+\)/,
  /^\s*\|.+\|\s*$/m,
]

export function looksLikeMarkdown(text) {
  return MARKDOWN_HINTS.some((re) => re.test(text ?? ''))
}
