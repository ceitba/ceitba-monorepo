import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import {
  acceptSuggestions,
  fetchSourceTree,
  patchFile,
  type DriveSource,
  type PatchFileBody,
  type TreeItem,
} from '../../api/drive'
import { apuntesErrorMessage, formatDate, formatSize } from '../../utils/apuntes'
import ErrorBanner from '../ErrorBanner'
import Notice from '../Notice'
import KindIcon from './KindIcon'
import { NotMineBadge, PublicationBadge } from './Badges'
import SubjectPicker, { type SubjectRef } from './SubjectPicker'
import { BTN_OUTLINE } from './buttons'

interface Props {
  sourceId: string
  // Called with the fresh Source whenever the tree is (re)loaded, so the
  // source card's counters stay in sync with subject/hidden edits.
  onSourceLoaded?: (source: DriveSource) => void
}

interface Node {
  item: TreeItem
  children: Node[]
}

function sortNodes(nodes: Node[]): Node[] {
  return nodes.sort((a, b) => {
    const af = a.item.kind === 'FOLDER' ? 0 : 1
    const bf = b.item.kind === 'FOLDER' ? 0 : 1
    return af - bf || a.item.name.localeCompare(b.item.name, undefined, { numeric: true, sensitivity: 'base' })
  })
}

// Flat TreeItem list → forest. Items whose parent isn't in the list (e.g. a
// parent that stopped syncing) are shown at the top level rather than lost.
function buildForest(items: TreeItem[]): Node[] {
  const byId = new Map<string, Node>()
  items.forEach((item) => byId.set(item.id, { item, children: [] }))
  const roots: Node[] = []
  byId.forEach((node) => {
    const parent = node.item.parentId ? byId.get(node.item.parentId) : undefined
    if (parent && parent !== node) parent.children.push(node)
    else roots.push(node)
  })
  const walk = (nodes: Node[]) => { sortNodes(nodes).forEach((n) => walk(n.children)) }
  walk(roots)
  return roots
}

function hasSuggestion(item: TreeItem): boolean {
  return item.suggestedSubjectId != null && item.suggestedSubjectId !== item.effectiveSubjectId
}

// Per-source file tree on /apuntes/mis-apuntes: assign subjects (inherited
// down the tree), take suggestions, hide items and see each file's
// publication state.
export default function SourceTreeView({ sourceId, onSourceLoaded }: Props) {
  const { t, i18n } = useTranslation()
  const [items, setItems] = useState<TreeItem[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())
  const [accepting, setAccepting] = useState(false)
  // Folders the user collapsed; everything starts expanded.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const reqRef = useRef(0)
  const onLoadedRef = useRef(onSourceLoaded)
  onLoadedRef.current = onSourceLoaded

  const load = useCallback((silent = false) => {
    const id = ++reqRef.current
    if (!silent) setLoading(true)
    return fetchSourceTree(sourceId)
      .then((res) => {
        if (reqRef.current !== id) return
        setItems(res.items ?? [])
        setLoadError(null)
        if (res.source) onLoadedRef.current?.(res.source)
      })
      .catch((e) => {
        if (reqRef.current !== id) return
        if (!silent) setLoadError(apuntesErrorMessage(e, t))
      })
      .finally(() => {
        if (reqRef.current === id) setLoading(false)
      })
  }, [sourceId, t])

  useEffect(() => {
    setItems(null)
    setCollapsed(new Set())
    void load()
  }, [load])

  const forest = useMemo(() => buildForest(items ?? []), [items])
  const suggestionCount = useMemo(() => (items ?? []).filter(hasSuggestion).length, [items])

  async function update(item: TreeItem, body: PatchFileBody) {
    setError(null)
    setBusyIds((s) => new Set(s).add(item.id))
    try {
      const updated = await patchFile(item.id, body)
      setItems((list) => list && list.map((it) => (it.id === updated.id ? { ...it, ...updated } : it)))
      // Subject/hidden changes on a folder ripple down to its descendants'
      // effective subject and publication: refresh the tree quietly.
      void load(true)
    } catch (e) {
      setError(apuntesErrorMessage(e, t))
    } finally {
      setBusyIds((s) => { const n = new Set(s); n.delete(item.id); return n })
    }
  }

  async function acceptAll() {
    setError(null); setNotice(null); setAccepting(true)
    try {
      const res = await acceptSuggestions(sourceId)
      setNotice(t('apuntes.tree.acceptedNotice', { count: res?.applied ?? 0 }))
      await load(true)
    } catch (e) {
      setError(apuntesErrorMessage(e, t))
    } finally {
      setAccepting(false)
    }
  }

  function toggleFolder(id: string) {
    setCollapsed((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  function renderNode(node: Node, depth: number) {
    const { item } = node
    const isFolder = item.kind === 'FOLDER'
    const isCollapsed = collapsed.has(item.id)
    const busy = busyIds.has(item.id)
    const value: SubjectRef | null = item.subjectId ? { id: item.subjectId, name: item.subjectName ?? item.subjectId } : null
    const inherited: SubjectRef | null =
      !item.subjectId && item.effectiveSubjectId
        ? { id: item.effectiveSubjectId, name: item.effectiveSubjectName ?? item.effectiveSubjectId }
        : null
    const meta = [formatSize(item.sizeBytes), item.driveModifiedAt ? formatDate(item.driveModifiedAt, i18n.language) : '']
      .filter(Boolean).join(' · ')
    const canPreview = !isFolder && !item.hidden && item.publication !== 'REMOVED'

    return (
      <li key={item.id} role="treeitem" aria-expanded={isFolder ? !isCollapsed : undefined} aria-level={depth + 1}>
        <div
          className={`flex flex-col lg:flex-row lg:items-center gap-2 lg:gap-4 py-3 pr-3 border-t border-border dark:border-night-border ${item.hidden ? 'opacity-60' : ''}`}
          style={{ paddingLeft: `${Math.min(depth, 6) * 1.25 + 0.75}rem` }}
        >
          <div className="flex items-start gap-2 min-w-0 flex-1">
            {isFolder ? (
              <button
                type="button"
                onClick={() => toggleFolder(item.id)}
                aria-label={t(isCollapsed ? 'apuntes.tree.expand' : 'apuntes.tree.collapse', { name: item.name })}
                className="w-5 h-5 mt-0.5 flex items-center justify-center text-ink-secondary dark:text-night-muted hover:text-primary flex-shrink-0"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true" className={`transition-transform duration-150 ${isCollapsed ? '' : 'rotate-90'}`}>
                  <polyline points="9 6 15 12 9 18" />
                </svg>
              </button>
            ) : (
              <span className="w-5 flex-shrink-0" aria-hidden="true" />
            )}
            <KindIcon kind={item.kind} className="mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="font-body text-body-sm text-ink-primary dark:text-night-text break-words">
                {canPreview ? (
                  <Link to={`/apuntes/archivo/${encodeURIComponent(item.id)}`} className="hover:text-primary hover:underline">
                    {item.name}
                  </Link>
                ) : item.name}
              </p>
              <div className="flex flex-wrap items-center gap-1.5 mt-1">
                {!isFolder && <PublicationBadge publication={item.publication} />}
                {!item.ownedByMe && <NotMineBadge />}
                {item.hidden && (
                  <span className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
                    {t('apuntes.tree.hiddenLabel')}
                  </span>
                )}
                {meta && <span className="font-mono text-label text-ink-secondary dark:text-night-muted">{meta}</span>}
              </div>
              {item.syncError && (
                <p className="mt-1 font-body text-body-sm text-red-600 dark:text-red-400">
                  {t('apuntes.tree.syncError', { error: item.syncError })}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pl-7 lg:pl-0">
            <div className="flex flex-col gap-1 w-full sm:w-auto">
              <SubjectPicker
                value={value}
                inherited={inherited}
                disabled={busy}
                label={t('apuntes.tree.subjectFor', { name: item.name })}
                onChange={(subjectId) => update(item, { subjectId })}
              />
              {hasSuggestion(item) && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => update(item, { subjectId: item.suggestedSubjectId! })}
                  title={t('apuntes.tree.useSuggestion')}
                  className="self-start inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-dashed border-accent-400 bg-accent-50 dark:bg-accent-900/30 text-accent-700 dark:text-accent-200 font-body text-body-sm hover:border-solid disabled:opacity-50"
                >
                  <span aria-hidden="true">＋</span>
                  {t('apuntes.tree.suggestion', { name: item.suggestedSubjectName ?? item.suggestedSubjectId })}
                </button>
              )}
            </div>
            <label className="inline-flex items-center gap-2 min-h-[36px] cursor-pointer font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
              <input
                type="checkbox"
                checked={item.hidden}
                disabled={busy}
                onChange={(e) => update(item, { hidden: e.target.checked })}
                className="h-4 w-4 accent-primary"
              />
              {t('apuntes.tree.hide')}
            </label>
          </div>
        </div>
        {isFolder && !isCollapsed && node.children.length > 0 && (
          <ul role="group">{node.children.map((c) => renderNode(c, depth + 1))}</ul>
        )}
      </li>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted max-w-2xl">
          {t('apuntes.tree.intro')}
        </p>
        <button
          type="button"
          onClick={acceptAll}
          disabled={accepting || suggestionCount === 0}
          className={BTN_OUTLINE}
        >
          {accepting ? '…' : t('apuntes.tree.acceptAll', { count: suggestionCount })}
        </button>
      </div>

      {error && <ErrorBanner onDismiss={() => setError(null)}>{error}</ErrorBanner>}
      {notice && <Notice onDismiss={() => setNotice(null)}>{notice}</Notice>}

      {loading && items == null && (
        <div className="flex flex-col gap-2" aria-busy="true" aria-hidden="true">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-12 rounded-sm skeleton" />)}
        </div>
      )}
      {loadError && (
        <ErrorBanner>
          {loadError}{' '}
          <button type="button" onClick={() => void load()} className="underline font-semibold">{t('errors.retry')}</button>
        </ErrorBanner>
      )}
      {!loading && !loadError && items != null && items.length === 0 && (
        <p className="py-6 text-center font-body text-body-sm text-ink-secondary dark:text-night-muted">
          {t('apuntes.tree.empty')}
        </p>
      )}
      {items != null && items.length > 0 && (
        <ul role="tree" aria-label={t('apuntes.tree.aria')} className="rounded-card border-b border-border dark:border-night-border">
          {forest.map((n) => renderNode(n, 0))}
        </ul>
      )}
    </div>
  )
}
