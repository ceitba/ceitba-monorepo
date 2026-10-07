import type { FileDetail } from '../../../api/drive'

// Which in-browser viewer an original can use, from its mime type (when the
// API sends it) or else its extension.
export type OriginalViewer = 'image' | 'docx' | 'sheet' | 'notebook' | 'text' | 'none'

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif']
const SHEET_EXT = ['xlsx', 'xls', 'ods', 'csv', 'xlsm']
const TEXT_EXT = [
  'txt', 'md', 'markdown', 'rst', 'log', 'tex', 'bib', 'json', 'xml', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf',
  'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'java', 'kt', 'scala', 'py', 'rb', 'go', 'rs', 'swift', 'js', 'mjs', 'ts', 'jsx', 'tsx',
  'php', 'sql', 'sh', 'bash', 'zsh', 'bat', 'ps1', 'm', 'r', 'jl', 'hs', 'ml', 'lisp', 'scm', 'clj', 'erl', 'ex', 'exs',
  'asm', 's', 'vhd', 'vhdl', 'v', 'sv', 'pl', 'lua', 'dart', 'html', 'htm', 'css', 'scss', 'gradle', 'make', 'mk', 'dockerfile',
]
const SHEET_MIME = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.ms-excel.sheet.macroenabled.12',
  'application/vnd.oasis.opendocument.spreadsheet',
  'text/csv',
]
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export function extensionOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name.trim())
  return m ? m[1].toLowerCase() : ''
}

export function detectOriginalViewer(file: Pick<FileDetail, 'name' | 'kind' | 'originalMimeType'>): OriginalViewer {
  const mime = (file.originalMimeType ?? '').toLowerCase().split(';')[0].trim()
  const ext = extensionOf(file.name)

  if (mime.startsWith('image/') || IMAGE_EXT.includes(ext) || (!mime && !ext && file.kind === 'IMAGE')) return 'image'
  if (mime === DOCX_MIME || ext === 'docx') return 'docx'
  if (SHEET_MIME.includes(mime) || SHEET_EXT.includes(ext)) return 'sheet'
  if (mime === 'application/x-ipynb+json' || ext === 'ipynb') return 'notebook'
  if (
    mime.startsWith('text/') ||
    ['application/json', 'application/xml', 'application/javascript', 'application/x-sh', 'application/x-tex'].includes(mime) ||
    TEXT_EXT.includes(ext)
  ) return 'text'
  return 'none'
}
