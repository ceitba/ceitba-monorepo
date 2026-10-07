import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useEditorState } from '@tiptap/react'
import { ALLOWED_IMAGE_TYPES } from '../../../api/media'

function isHttpUrl(value) {
  try {
    const u = new URL(value)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}

function withProtocol(value) {
  const v = value.trim()
  if (!v) return v
  return /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`
}

export default function EditorToolbar({ editor, mode, onToggleMode, canUpload, uploading, onPickImages }) {
  const { t } = useTranslation()
  const [urlMode, setUrlMode] = useState(null) // 'link' | 'image' | null
  const [url, setUrl] = useState('')
  const [urlError, setUrlError] = useState('')
  const fileRef = useRef(null)

  const state = useEditorState({
    editor,
    selector: ({ editor: ed }) => {
      if (!ed) return null
      return {
        block: ed.isActive('heading', { level: 2 }) ? 'h2'
          : ed.isActive('heading', { level: 3 }) ? 'h3'
          : ed.isActive('heading', { level: 4 }) ? 'h4'
          : ed.isActive('heading', { level: 1 }) ? 'h1'
          : 'p',
        bold: ed.isActive('bold'),
        italic: ed.isActive('italic'),
        strike: ed.isActive('strike'),
        code: ed.isActive('code'),
        link: ed.isActive('link'),
        bulletList: ed.isActive('bulletList'),
        orderedList: ed.isActive('orderedList'),
        blockquote: ed.isActive('blockquote'),
        codeBlock: ed.isActive('codeBlock'),
        table: ed.isActive('table'),
        canUndo: ed.can().undo(),
        canRedo: ed.can().redo(),
      }
    },
  })

  if (!editor || !state) return null
  const visual = mode === 'visual'
  const chain = () => editor.chain().focus()

  function setBlock(value) {
    if (value === 'p') chain().setParagraph().run()
    else chain().setHeading({ level: Number(value.slice(1)) }).run()
  }

  function openUrl(kind) {
    setUrlError('')
    if (urlMode === kind) { setUrlMode(null); return }
    setUrl(kind === 'link' ? editor.getAttributes('link').href ?? '' : '')
    setUrlMode(kind)
  }

  function applyUrl() {
    const next = withProtocol(url)
    if (urlMode === 'link') {
      if (!next) chain().extendMarkRange('link').unsetLink().run()
      else if (!isHttpUrl(next) && !next.startsWith('mailto:')) { setUrlError(t('editor.errors.url')); return }
      else chain().extendMarkRange('link').setLink({ href: next }).run()
    } else if (urlMode === 'image') {
      if (!isHttpUrl(next)) { setUrlError(t('editor.errors.url')); return }
      chain().setImage({ src: next }).run()
    }
    setUrlMode(null)
    setUrl('')
  }

  function insertMermaid() {
    chain().insertContent({
      type: 'codeBlock',
      attrs: { language: 'mermaid' },
      content: [{ type: 'text', text: 'flowchart LR\n  A[Idea] --> B[Borrador] --> C[Publicado]' }],
    }).run()
  }

  return (
    <div className="sticky top-14 z-10 bg-white border-b border-border rounded-t-card">
      <div className="flex flex-wrap items-center gap-1 px-2 sm:px-3 py-2" role="toolbar" aria-label={t('editor.toolbar')}>
        {visual && (
          <>
            <select
              value={state.block}
              onChange={(e) => setBlock(e.target.value)}
              aria-label={t('editor.blockType')}
              className="min-h-[34px] pl-2 pr-7 border border-border rounded-sm bg-white font-body text-body-sm text-ink-primary focus:outline-none focus:border-primary"
            >
              <option value="p">{t('editor.blocks.p')}</option>
              <option value="h2">{t('editor.blocks.h2')}</option>
              <option value="h3">{t('editor.blocks.h3')}</option>
              <option value="h4">{t('editor.blocks.h4')}</option>
              {state.block === 'h1' && <option value="h1">{t('editor.blocks.h1')}</option>}
            </select>
            <Sep />
            <Btn label={t('editor.bold')} shortcut="⌘B" active={state.bold} onClick={() => chain().toggleBold().run()}><b className="font-display">B</b></Btn>
            <Btn label={t('editor.italic')} shortcut="⌘I" active={state.italic} onClick={() => chain().toggleItalic().run()}><i className="font-display">I</i></Btn>
            <Btn label={t('editor.strike')} active={state.strike} onClick={() => chain().toggleStrike().run()}><s className="font-display">S</s></Btn>
            <Btn label={t('editor.inlineCode')} active={state.code} onClick={() => chain().toggleCode().run()}><IconCode /></Btn>
            <Btn label={t('editor.link')} active={state.link || urlMode === 'link'} onClick={() => openUrl('link')}><IconLink /></Btn>
            <Sep />
            <Btn label={t('editor.bulletList')} active={state.bulletList} onClick={() => chain().toggleBulletList().run()}><IconBullets /></Btn>
            <Btn label={t('editor.orderedList')} active={state.orderedList} onClick={() => chain().toggleOrderedList().run()}><IconNumbers /></Btn>
            <Btn label={t('editor.quote')} active={state.blockquote} onClick={() => chain().toggleBlockquote().run()}><IconQuote /></Btn>
            <Btn label={t('editor.divider')} onClick={() => chain().setHorizontalRule().run()}><IconRule /></Btn>
            <Sep />
            <Btn
              label={canUpload ? t('editor.imageUpload') : t('editor.imageUrl')}
              disabled={uploading}
              onClick={() => (canUpload ? fileRef.current?.click() : openUrl('image'))}
            >
              {uploading ? <span className="font-mono text-label">…</span> : <IconImage />}
            </Btn>
            {canUpload && (
              <Btn label={t('editor.imageUrl')} active={urlMode === 'image'} onClick={() => openUrl('image')}><IconImageLink /></Btn>
            )}
            <Btn label={t('editor.table')} active={state.table} onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><IconTable /></Btn>
            <Btn label={t('editor.codeBlock')} active={state.codeBlock} onClick={() => chain().toggleCodeBlock().run()}><IconCodeBlock /></Btn>
            <Btn label={t('editor.mermaid')} onClick={insertMermaid}><IconDiagram /></Btn>
            <Sep />
            <Btn label={t('editor.undo')} shortcut="⌘Z" disabled={!state.canUndo} onClick={() => chain().undo().run()}><IconUndo /></Btn>
            <Btn label={t('editor.redo')} shortcut="⇧⌘Z" disabled={!state.canRedo} onClick={() => chain().redo().run()}><IconRedo /></Btn>
          </>
        )}
        <button
          type="button"
          onClick={onToggleMode}
          aria-pressed={!visual}
          title={t('editor.markdownToggleHint')}
          className={[
            'ml-auto min-h-[34px] px-2.5 flex items-center gap-1.5 rounded-sm border font-mono text-label uppercase tracking-widest transition-colors duration-150',
            visual ? 'border-border text-ink-secondary hover:border-primary hover:text-primary' : 'border-primary bg-primary text-white',
          ].join(' ')}
        >
          <IconMarkdown />
          {visual ? t('editor.markdown') : t('editor.visual')}
        </button>
      </div>

      {visual && state.table && (
        <div className="flex flex-wrap items-center gap-1 px-3 pb-2 font-body text-body-sm">
          <span className="font-mono text-label uppercase tracking-widest text-ink-secondary mr-1">{t('editor.tableTools')}</span>
          <TextBtn onClick={() => chain().addRowAfter().run()}>{t('editor.addRow')}</TextBtn>
          <TextBtn onClick={() => chain().addColumnAfter().run()}>{t('editor.addColumn')}</TextBtn>
          <TextBtn onClick={() => chain().deleteRow().run()}>{t('editor.deleteRow')}</TextBtn>
          <TextBtn onClick={() => chain().deleteColumn().run()}>{t('editor.deleteColumn')}</TextBtn>
          <TextBtn danger onClick={() => chain().deleteTable().run()}>{t('editor.deleteTable')}</TextBtn>
        </div>
      )}

      {visual && urlMode && (
        <div className="flex flex-wrap items-center gap-2 px-3 pb-3">
          <input
            autoFocus
            type="url"
            value={url}
            onChange={(e) => { setUrl(e.target.value); setUrlError('') }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); applyUrl() }
              if (e.key === 'Escape') { e.preventDefault(); setUrlMode(null); editor.commands.focus() }
            }}
            placeholder={urlMode === 'link' ? t('editor.linkPlaceholder') : t('editor.imagePlaceholder')}
            aria-label={urlMode === 'link' ? t('editor.link') : t('editor.imageUrl')}
            className="flex-1 min-w-[12rem] min-h-[36px] px-3 border border-border rounded-sm font-body text-body-sm text-ink-primary bg-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
          />
          <button type="button" onClick={applyUrl} className="min-h-[36px] px-3 bg-primary text-surface font-body text-body-sm font-semibold rounded-sm hover:bg-primary-600 transition-colors duration-150">
            {t('editor.apply')}
          </button>
          {urlMode === 'link' && state.link && (
            <button type="button" onClick={() => { chain().extendMarkRange('link').unsetLink().run(); setUrlMode(null) }} className="min-h-[36px] px-3 font-body text-body-sm text-red-600 hover:bg-red-50 rounded-sm">
              {t('editor.removeLink')}
            </button>
          )}
          {urlError && <span className="w-full font-body text-body-sm text-red-600">{urlError}</span>}
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        multiple
        accept={ALLOWED_IMAGE_TYPES.join(',')}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => { onPickImages([...e.target.files]); e.target.value = '' }}
      />
    </div>
  )
}

function Btn({ label, shortcut, active, disabled, onClick, children }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active ?? undefined}
      title={shortcut ? `${label} (${shortcut})` : label}
      className={[
        'w-[34px] h-[34px] flex items-center justify-center rounded-sm transition-colors duration-150 disabled:opacity-40 disabled:pointer-events-none',
        active ? 'bg-primary-50 text-primary' : 'text-ink-secondary hover:bg-surface hover:text-primary',
      ].join(' ')}
    >
      <span className="w-4 h-4 flex items-center justify-center text-[15px] leading-none">{children}</span>
    </button>
  )
}

function TextBtn({ danger, onClick, children }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={['min-h-[30px] px-2 rounded-sm transition-colors duration-150', danger ? 'text-red-600 hover:bg-red-50' : 'text-ink-secondary hover:bg-surface hover:text-primary'].join(' ')}
    >
      {children}
    </button>
  )
}

function Sep() { return <span className="w-px h-5 bg-border mx-1" aria-hidden="true" /> }

const svg = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }
function IconCode()      { return <svg {...svg}><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg> }
function IconLink()      { return <svg {...svg}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> }
function IconBullets()   { return <svg {...svg}><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/></svg> }
function IconNumbers()   { return <svg {...svg}><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/></svg> }
function IconQuote()     { return <svg {...svg}><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/></svg> }
function IconRule()      { return <svg {...svg}><line x1="3" y1="12" x2="21" y2="12"/></svg> }
function IconImage()     { return <svg {...svg}><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg> }
function IconImageLink() { return <svg {...svg}><path d="M21 12V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M16 19a2 2 0 0 0 2 2h1a2 2 0 0 0 0-4h-1"/><path d="M21 17a2 2 0 0 1 0 4"/></svg> }
function IconTable()     { return <svg {...svg}><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="12" y1="3" x2="12" y2="21"/></svg> }
function IconCodeBlock() { return <svg {...svg}><rect x="3" y="4" width="18" height="16" rx="2"/><polyline points="10 10 8 12 10 14"/><polyline points="14 10 16 12 14 14"/></svg> }
function IconDiagram()   { return <svg {...svg}><rect x="3" y="3" width="7" height="6" rx="1"/><rect x="14" y="15" width="7" height="6" rx="1"/><path d="M6.5 9v3a3 3 0 0 0 3 3h4.5"/></svg> }
function IconUndo()      { return <svg {...svg}><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg> }
function IconRedo()      { return <svg {...svg}><polyline points="15 14 20 9 15 4"/><path d="M4 20v-7a4 4 0 0 1 4-4h12"/></svg> }
function IconMarkdown()  { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 15V9l2.5 3L11 9v6"/><path d="M15.5 9v6"/><path d="M13.5 13l2 2 2-2"/></svg> }
