import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EditorContent, ReactNodeViewRenderer, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import CodeBlock from '@tiptap/extension-code-block'
import Image from '@tiptap/extension-image'
import { TableCell, TableHeader, TableKit } from '@tiptap/extension-table'
import HardBreak from '@tiptap/extension-hard-break'
import Paragraph from '@tiptap/extension-paragraph'
import { Placeholder } from '@tiptap/extensions'
import { Markdown } from '@tiptap/markdown'
import CodeBlockView from './CodeBlockView'
import EditorToolbar from './EditorToolbar'
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES, uploadViaSignedUrl } from '../../../api/media'
import { looksLikeMarkdown } from '../../../utils/articleBody'

// The fence must be longer than any backtick run inside the code, or a
// ``` line in the code would end the block early.
const CodeBlockWithPreview = CodeBlock.extend({
  addNodeView() { return ReactNodeViewRenderer(CodeBlockView) },
  renderMarkdown(node, h) {
    const code = node.content ? h.renderChildren(node.content) : ''
    const longest = Math.max(0, ...(code.match(/`{3,}/g) ?? []).map((run) => run.length))
    const fence = '`'.repeat(Math.max(3, longest + 1))
    return `${fence}${node.attrs?.language ?? ''}\n${code}\n${fence}`
  },
})

// The Markdown serializer doesn't escape text that only means something at
// the start of a line, so a paragraph reading "1. Ser alumno" or "- x" came
// back as a list after saving. Escape those markers (and setext underlines,
// and indentation that would make a code block) line by line.
function escapeLineStarts(markdown) {
  return markdown
    .split('\n')
    .map((line) => line
      .replace(/^ {4,}/, '')
      .replace(/^(\s{0,3})(\d+)([.)])(\s|$)/, '$1$2\\$3$4')
      .replace(/^(\s{0,3})([-+])(\s|$)/, '$1\\$2$3')
      .replace(/^(\s{0,3})(#{1,6})(\s|$)/, '$1\\$2$3')
      .replace(/^(\s{0,3})([=-]+\s*)$/, '$1\\$2'))
    .join('\n')
}

const SafeParagraph = Paragraph.extend({
  renderMarkdown(node, h, ctx) {
    return escapeLineStarts(this.parent?.(node, h, ctx) ?? '')
  },
})

// Line breaks inside a table cell or a heading can't be written as
// Markdown (a cell would need raw <br>, a heading would split in two), so
// Shift+Enter does nothing there.
const SafeHardBreak = HardBreak.extend({
  addKeyboardShortcuts() {
    const insert = () => {
      const { editor } = this
      if (editor.isActive('heading') || editor.isActive('tableCell') || editor.isActive('tableHeader')) return true
      return editor.commands.setHardBreak()
    }
    return { 'Mod-Enter': insert, 'Shift-Enter': insert }
  },
})

// GFM table cells hold one line of inline text.
const SingleLineCell = TableCell.extend({ content: 'paragraph' })
const SingleLineHeader = TableHeader.extend({ content: 'paragraph' })

function imageFiles(dataTransfer) {
  return [...(dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/'))
}

// Word/Excel/PowerPoint put a PNG rendering of the selection next to the
// HTML: that's a text paste, not an image paste. Only treat the clipboard
// as images when its HTML (if any) is nothing but images.
function isImagePaste(clipboard) {
  if (!imageFiles(clipboard).length) return false
  const html = clipboard.getData('text/html')
  if (!html) return true
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return !doc.body.textContent.trim() && doc.body.querySelectorAll('img').length > 0
}

// WYSIWYG article body editor. The document is Markdown in and out
// (`value` is only read on mount; every change reports the new Markdown),
// styled with the same `article-prose` class the article page uses.
//
// Pasting keeps formatting: HTML on the clipboard (Claude, Google Docs, Word,
// web pages) goes through ProseMirror's HTML parser; plain text that looks
// like Markdown is parsed as Markdown. Images can be pasted, dropped or
// picked — uploaded when the user may upload (staff), otherwise by URL.
export default function RichTextEditor({ value, onChange, canUpload, invalid }) {
  const { t } = useTranslation()
  const [mode, setMode] = useState('visual') // 'visual' | 'markdown'
  const [source, setSource] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const editorRef = useRef(null)
  const placeholderRef = useRef(t('editor.placeholder'))
  placeholderRef.current = t('editor.placeholder')
  const sourceAtToggleRef = useRef('')

  async function uploadImages(files) {
    const editor = editorRef.current
    if (!editor || !files.length) return
    if (!canUpload) { setUploadError(t('editor.errors.uploadForbidden')); return }
    setUploadError('')
    setUploading(true)
    try {
      for (const file of files) {
        if (!ALLOWED_IMAGE_TYPES.includes(file.type)) { setUploadError(t('imageUploader.errors.type')); continue }
        if (file.size > MAX_IMAGE_BYTES) { setUploadError(t('imageUploader.errors.size')); continue }
        const src = await uploadViaSignedUrl(file)
        // At the cursor as it is now: the user may have kept typing.
        editor.chain().focus().insertContent({ type: 'image', attrs: { src, alt: file.name.replace(/\.[^.]+$/, '') } }).run()
      }
    } catch (err) {
      setUploadError(
        err?.status === 501 ? t('imageUploader.errors.notConfigured')
          : err?.status === 403 ? t('imageUploader.errors.forbidden')
          : t('imageUploader.errors.upload'),
      )
    } finally {
      setUploading(false)
    }
  }

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
        codeBlock: false,
        paragraph: false,
        hardBreak: false,
        // `++text++` isn't Markdown any renderer understands.
        underline: false,
        link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
      }),
      SafeParagraph,
      SafeHardBreak,
      CodeBlockWithPreview,
      Image,
      TableKit.configure({ table: { resizable: false }, tableCell: false, tableHeader: false }),
      SingleLineCell,
      SingleLineHeader,
      Placeholder.configure({ placeholder: () => placeholderRef.current }),
      Markdown,
    ],
    content: value ?? '',
    contentType: 'markdown',
    editorProps: {
      attributes: {
        class: 'article-prose article-editor',
        'aria-label': t('admin.articleForm.body'),
        'aria-multiline': 'true',
        role: 'textbox',
      },
      handlePaste(view, event) {
        const ed = editorRef.current
        if (event.clipboardData && isImagePaste(event.clipboardData)) {
          event.preventDefault()
          uploadImages(imageFiles(event.clipboardData))
          return true
        }
        const html = event.clipboardData?.getData('text/html')
        const text = event.clipboardData?.getData('text/plain')
        if (html || !text || !ed || ed.isActive('codeBlock')) return false
        if (!looksLikeMarkdown(text)) return false
        event.preventDefault()
        ed.chain().focus().insertContent(text, { contentType: 'markdown' }).run()
        return true
      },
      handleDrop(view, event, _slice, moved) {
        if (moved) return false
        const files = imageFiles(event.dataTransfer)
        if (!files.length) return false
        event.preventDefault()
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
        if (pos != null) editorRef.current?.commands.setTextSelection(pos)
        uploadImages(files)
        return true
      },
    },
    onUpdate({ editor: ed }) {
      onChangeRef.current(ed.getMarkdown())
    },
  })
  editorRef.current = editor

  // Placeholder text follows the UI language (read through the ref); an
  // empty transaction makes ProseMirror redraw the decoration.
  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr)
  }, [editor, t])

  const counts = useEditorState({
    editor,
    selector: ({ editor: ed }) => {
      const text = ed?.state.doc.textContent ?? ''
      return { words: text.trim() ? text.trim().split(/\s+/).length : 0 }
    },
  })

  function toggleMode() {
    if (!editor) return
    if (mode === 'visual') {
      const md = editor.getMarkdown()
      sourceAtToggleRef.current = md
      setSource(md)
      setMode('markdown')
    } else {
      // Re-parsing normalizes the Markdown; only report it when it was edited.
      const edited = source !== sourceAtToggleRef.current
      editor.commands.setContent(source, { contentType: 'markdown', emitUpdate: edited })
      setMode('visual')
    }
  }

  return (
    <div className={['article-editor-shell rounded-card border bg-white shadow-card', invalid ? 'border-red-400' : 'border-border'].join(' ')}>
      <EditorToolbar
        editor={editor}
        mode={mode}
        onToggleMode={toggleMode}
        canUpload={canUpload}
        uploading={uploading}
        onPickImages={(files) => uploadImages(files)}
      />
      {uploadError && (
        <p role="alert" className="mx-4 mt-3 font-body text-body-sm text-red-600 bg-red-50 px-3 py-2 rounded-sm">{uploadError}</p>
      )}
      {mode === 'visual' ? (
        <EditorContent editor={editor} className="px-5 sm:px-8 py-6" />
      ) : (
        <div className="px-5 sm:px-8 py-6">
          <p className="mb-3 font-mono text-label text-ink-secondary">{t('editor.markdownHint')}</p>
          <textarea
            value={source}
            onChange={(e) => { setSource(e.target.value); onChangeRef.current(e.target.value) }}
            spellCheck
            aria-label={t('editor.markdownSource')}
            className="w-full min-h-[28rem] font-mono text-body-sm text-ink-primary bg-transparent focus:outline-none resize-y"
          />
        </div>
      )}
      <div className="flex items-center justify-between gap-3 px-5 sm:px-8 py-2 border-t border-border">
        <span className="font-mono text-label text-ink-secondary">
          {t('editor.words', { count: mode === 'visual' ? counts?.words ?? 0 : (source.trim() ? source.trim().split(/\s+/).length : 0) })}
        </span>
        <span className="font-mono text-label text-ink-secondary hidden sm:inline">{t('editor.pasteHint')}</span>
      </div>
    </div>
  )
}
