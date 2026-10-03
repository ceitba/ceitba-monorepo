import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EditorContent, ReactNodeViewRenderer, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import CodeBlock from '@tiptap/extension-code-block'
import Image from '@tiptap/extension-image'
import { TableKit } from '@tiptap/extension-table'
import { Placeholder } from '@tiptap/extensions'
import { Markdown } from '@tiptap/markdown'
import CodeBlockView from './CodeBlockView'
import EditorToolbar from './EditorToolbar'
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES, uploadViaSignedUrl } from '../../../api/media'
import { looksLikeMarkdown } from '../../../utils/articleBody'

const CodeBlockWithPreview = CodeBlock.extend({
  addNodeView() { return ReactNodeViewRenderer(CodeBlockView) },
})

function imageFiles(dataTransfer) {
  return [...(dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/'))
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

  async function uploadImages(files, pos) {
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
        const image = { type: 'image', attrs: { src, alt: file.name.replace(/\.[^.]+$/, '') } }
        if (pos != null) editor.chain().focus().insertContentAt(pos, image).run()
        else editor.chain().focus().insertContent(image).run()
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
        // `++text++` isn't Markdown any renderer understands.
        underline: false,
        link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
      }),
      CodeBlockWithPreview,
      Image,
      TableKit.configure({ table: { resizable: false } }),
      Placeholder.configure({ placeholder: t('editor.placeholder') }),
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
        const files = imageFiles(event.clipboardData)
        if (files.length) {
          event.preventDefault()
          uploadImages(files)
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
        uploadImages(files, pos)
        return true
      },
    },
    onUpdate({ editor: ed }) {
      onChangeRef.current(ed.getMarkdown())
    },
  })
  editorRef.current = editor

  // Placeholder text follows the UI language.
  useEffect(() => {
    if (!editor) return
    const ext = editor.extensionManager.extensions.find((e) => e.name === 'placeholder')
    if (ext) { ext.options.placeholder = t('editor.placeholder'); editor.view.dispatch(editor.state.tr) }
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
      setSource(editor.getMarkdown())
      setMode('markdown')
    } else {
      editor.commands.setContent(source, { contentType: 'markdown', emitUpdate: true })
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
