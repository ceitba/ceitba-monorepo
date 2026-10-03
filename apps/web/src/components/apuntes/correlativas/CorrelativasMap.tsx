import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { usePins } from '../../../hooks/usePins'
import { closure, edgePath, layoutColumns, type CorrModel, type CorrNode } from '../../../utils/correlatividades'
import PinButton from '../PinButton'
import { yearLabel } from '../../../utils/planGroups'

const MIN_Z = 0.4
const MAX_Z = 1.4

function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

// Highlight state for one hovered/focused subject.
interface Focus {
  id: string
  up: Set<string> // everything it needs, transitively
  down: Set<string> // everything it unlocks, transitively
}

function useIsPhone(): boolean {
  const query = '(max-width: 639px)'
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setPhone(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return phone
}

// Layered map of a plan's correlatividades: one column per cuatrimestre,
// dependency → subject curves, upstream/downstream highlight on hover or
// focus, search, zoom, and electives below. Phones get a list instead.
export default function CorrelativasMap({ model }: { model: CorrModel }) {
  const { t } = useTranslation()
  const phone = useIsPhone()
  const { pins } = usePins()
  const pinnedWiki = useMemo(() => new Map((pins ?? []).map((p) => [p.subjectId, p.hasWiki])), [pins])
  const layout = useMemo(() => layoutColumns(model), [model])
  const [focus, setFocus] = useState<Focus | null>(null)
  const [query, setQuery] = useState('')
  const [zoom, setZoom] = useState(1)
  const scrollRef = useRef<HTMLDivElement>(null)

  const focusOn = (id: string | null) => {
    if (!id) { setFocus(null); return }
    setFocus({
      id,
      up: closure(id, (x) => model.nodes.get(x)?.deps ?? []),
      down: closure(id, (x) => model.nodes.get(x)?.dependents ?? []),
    })
  }

  const matches = useMemo(() => {
    const q = normalize(query.trim())
    if (!q) return null
    return new Set([...model.nodes.values()].filter((n) => normalize(n.id).includes(q) || normalize(n.name).includes(q)).map((n) => n.id))
  }, [query, model])

  // Scroll the first match into view.
  useEffect(() => {
    if (!matches || matches.size === 0) return
    const id = window.setTimeout(() => {
      const first = [...matches][0]
      document.getElementById(`corr-${cssId(first)}`)?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' })
    }, 250)
    return () => window.clearTimeout(id)
  }, [matches])

  function fit() {
    const w = scrollRef.current?.clientWidth ?? layout.width
    setZoom(Math.max(MIN_Z, Math.min(1, w / layout.width)))
  }

  function state(n: CorrNode): string {
    if (matches) return matches.has(n.id) ? 'is-match' : 'is-dim'
    if (!focus) return ''
    if (n.id === focus.id) return 'is-focus'
    if (focus.up.has(n.id)) return 'is-up'
    if (focus.down.has(n.id)) return 'is-down'
    return 'is-dim'
  }

  function edgeState(from: string, to: string): string {
    if (!focus) return matches ? 'is-dim' : ''
    const upChain = (focus.up.has(from) || from === focus.id) && (focus.up.has(to) || to === focus.id)
    const downChain = (focus.down.has(from) || from === focus.id) && (focus.down.has(to) || to === focus.id)
    if (upChain && from !== focus.id) return 'is-up'
    if (downChain && to !== focus.id) return 'is-down'
    return 'is-dim'
  }

  const card = (n: CorrNode, style?: React.CSSProperties) => (
    <CorrCard
      key={n.id}
      node={n}
      hasWiki={n.hasWiki || !!pinnedWiki.get(n.id)}
      state={state(n)}
      style={style}
      onFocusChange={(on) => focusOn(on ? n.id : null)}
      model={model}
      showDeps={!n.curricular}
    />
  )

  const toolbar = (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-3">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('apuntes.corr.search')}
        aria-label={t('apuntes.corr.search')}
        className="sm:w-72 px-3 py-2 rounded-sm border border-border dark:border-night-border bg-white dark:bg-night-surface font-body text-body-sm focus:outline-none focus:border-primary"
      />
      {matches && (
        <span className="font-mono text-label text-ink-secondary dark:text-night-muted" aria-live="polite">
          {t('wiki.graphUi.matches', { count: matches.size })}
        </span>
      )}
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted sm:ml-auto" aria-label={t('wiki.legend')}>
        <li className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm corr-swatch-up" aria-hidden="true" />{t('apuntes.corr.legendUp')}</li>
        <li className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm corr-swatch-down" aria-hidden="true" />{t('apuntes.corr.legendDown')}</li>
      </ul>
      {!phone && (
            <div className="flex items-center gap-2 px-2 py-1 rounded-sm border border-border dark:border-night-border bg-white dark:bg-night-surface">
              <button type="button" onClick={() => setZoom((z) => Math.max(MIN_Z, +(z - 0.1).toFixed(2)))} aria-label={t('wiki.graphUi.zoomOut')} className="w-7 h-7 font-mono hover:text-primary">−</button>
              <input
                type="range"
                min={MIN_Z}
                max={MAX_Z}
                step={0.05}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                aria-label={t('apuntes.corr.zoom')}
                className="w-24 accent-primary"
              />
              <button type="button" onClick={() => setZoom((z) => Math.min(MAX_Z, +(z + 0.1).toFixed(2)))} aria-label={t('wiki.graphUi.zoomIn')} className="w-7 h-7 font-mono hover:text-primary">+</button>
              <button type="button" onClick={fit} className="px-2 h-7 font-mono text-label uppercase tracking-widest hover:text-primary">{t('wiki.graphUi.fit')}</button>
            </div>
      )}
    </div>
  )

  return (
    <div className="flex flex-col gap-6">
      <div>
        {toolbar}
        {phone ? (
          <PhoneList model={model} state={state} pinnedWiki={pinnedWiki} />
        ) : (
          <div className="relative rounded-card border border-border dark:border-night-border bg-page-bg dark:bg-night-bg">
            <div ref={scrollRef} className="overflow-auto max-h-[75vh]">
              <div style={{ width: layout.width * zoom, height: layout.height * zoom }}>
                <div
                  className={`corr-map relative ${focus || matches ? 'has-focus' : ''}`}
                  style={{ width: layout.width, height: layout.height, transform: `scale(${zoom})`, transformOrigin: '0 0' }}
                >
                  {model.columns.map((c, ci) => (
                    <div
                      key={c.key}
                      className="absolute font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted"
                      style={{ left: layout.columnX[ci], top: 16, width: layout.cardW }}
                    >
                      {yearLabel(c.year, t)} · {t('apuntes.plan.semester', { semester: c.semester })}
                    </div>
                  ))}
                  <svg className="absolute inset-0 pointer-events-none" width={layout.width} height={layout.height} aria-hidden="true">
                    {model.columns.flatMap((c) => c.ids).flatMap((id) => {
                      return (model.nodes.get(id)?.deps ?? []).map((dep) => {
                        const d = edgePath(dep, id, layout)
                        return d ? <path key={`${dep}>${id}`} d={d} className={`corr-edge ${edgeState(dep, id)}`} /> : null
                      })
                    })}
                  </svg>
                  {model.columns.flatMap((c) => c.ids).map((id) => {
                    const p = layout.pos.get(id)!
                    return card(model.nodes.get(id)!, { position: 'absolute', left: p.x, top: p.y, width: layout.cardW, height: layout.cardH })
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {model.electives.length > 0 && (
        <details className="group/elect rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface">
          <summary className="cursor-pointer list-none flex items-center gap-2 px-4 py-3 select-none">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true" className="text-ink-secondary dark:text-night-muted transition-transform duration-150 group-open/elect:rotate-90">
              <polyline points="9 6 15 12 9 18" />
            </svg>
            <span className="font-display font-bold text-h5 text-ink-primary dark:text-night-text">{t('apuntes.corr.electives')}</span>
            <span className="font-mono text-label text-ink-secondary dark:text-night-muted">
              {t('apuntes.plan.subjectCount', { count: model.electives.reduce((a, s) => a + s.ids.length, 0) })}
            </span>
          </summary>
          <div className={`corr-map flex flex-col gap-6 px-4 pb-5 ${focus || matches ? 'has-focus' : ''}`}>
            {model.electives.map((s) => (
              <section key={s.section || '-'}>
                <h3 className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted mb-2">
                  {s.section || t('apuntes.plan.otherSubjects')}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {s.ids.map((id) => card(model.nodes.get(id)!))}
                </div>
              </section>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

function cssId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function CorrCard({ node: n, hasWiki, state, style, onFocusChange, model, showDeps }: {
  node: CorrNode
  hasWiki: boolean
  state: string
  style?: React.CSSProperties
  onFocusChange: (on: boolean) => void
  model: CorrModel
  showDeps: boolean
}) {
  const { t } = useTranslation()
  return (
    <div
      id={`corr-${cssId(n.id)}`}
      className={`corr-card relative flex flex-col rounded-card border bg-white dark:bg-night-surface ${state}`}
      style={style}
      onMouseEnter={() => onFocusChange(true)}
      onMouseLeave={() => onFocusChange(false)}
      onFocus={() => onFocusChange(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onFocusChange(false) }}
    >
      <Link
        to={`/apuntes/${encodeURIComponent(n.id)}`}
        className="flex-1 min-h-0 flex flex-col gap-0.5 pl-3 pr-9 py-2 rounded-card focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        aria-describedby={n.deps.length ? `corr-deps-${cssId(n.id)}` : undefined}
      >
        <span className="font-mono text-label text-ink-secondary dark:text-night-muted">{n.id}</span>
        <span className="font-body text-body-sm font-semibold leading-snug text-ink-primary dark:text-night-text line-clamp-2">{n.name}</span>
        <span className="mt-auto flex flex-wrap items-center gap-1 font-mono text-[0.65rem] text-ink-secondary dark:text-night-muted">
          {hasWiki && <span className="px-1 rounded-sm bg-primary-50 dark:bg-primary-900 text-primary-700 dark:text-primary-200">{t('apuntes.pins.wiki')}</span>}
          {n.fileCount > 0 && <span>{t('apuntes.home.fileCount', { count: n.fileCount })}</span>}
          {n.creditsRequired > 0 && <span className="italic">{t('apuntes.corr.credits', { count: n.creditsRequired })}</span>}
        </span>
        {showDeps && n.deps.length > 0 && (
          <span className="font-body text-[0.7rem] text-ink-secondary dark:text-night-muted">
            {t('apuntes.corr.requires')}: {n.deps.join(', ')}
          </span>
        )}
      </Link>
      <span id={`corr-deps-${cssId(n.id)}`} className="sr-only">
        {n.deps.length ? `${t('apuntes.corr.requires')}: ${n.deps.map((d) => model.nodes.get(d)?.name ?? d).join(', ')}` : ''}
      </span>
      <PinButton subject={{ subjectId: n.id, subjectName: n.name, fileCount: n.fileCount, hasWiki }} className="absolute top-1 right-1" />
    </div>
  )
}

function PhoneList({ model, state, pinnedWiki }: {
  model: CorrModel
  state: (n: CorrNode) => string
  pinnedWiki: Map<string, boolean>
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-6">
      {model.columns.map((c) => (
        <section key={c.key}>
          <h3 className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted mb-2">
            {yearLabel(c.year, t)} · {t('apuntes.plan.semester', { semester: c.semester })}
          </h3>
          <ul className="flex flex-col divide-y divide-border dark:divide-night-border rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface">
            {c.ids.map((id) => {
              const n = model.nodes.get(id)!
              const hasWiki = n.hasWiki || !!pinnedWiki.get(id)
              return (
                <li key={id} className={`relative px-3 py-2.5 pr-11 ${state(n) === 'is-match' ? 'bg-accent-50 dark:bg-accent-900/30' : ''}`}>
                  <Link to={`/apuntes/${encodeURIComponent(id)}`} className="block">
                    <span className="font-mono text-label text-ink-secondary dark:text-night-muted mr-2">{id}</span>
                    <span className="font-body text-body-sm font-semibold text-ink-primary dark:text-night-text">{n.name}</span>
                    {hasWiki && <span className="ml-2 px-1 rounded-sm bg-primary-50 dark:bg-primary-900 text-primary-700 dark:text-primary-200 font-mono text-[0.65rem]">{t('apuntes.pins.wiki')}</span>}
                  </Link>
                  <p className="font-body text-[0.75rem] text-ink-secondary dark:text-night-muted mt-0.5">
                    {n.deps.length ? (
                      <>
                        {t('apuntes.corr.requires')}:{' '}
                        {n.deps.map((d, i) => (
                          <span key={d}>
                            {i > 0 && ', '}
                            <Link to={`/apuntes/${encodeURIComponent(d)}`} className="underline">{d}</Link>
                          </span>
                        ))}
                      </>
                    ) : t('apuntes.corr.noDeps')}
                    {n.creditsRequired > 0 && ` · ${t('apuntes.corr.credits', { count: n.creditsRequired })}`}
                  </p>
                  <PinButton subject={{ subjectId: id, subjectName: n.name, fileCount: n.fileCount, hasWiki }} className="absolute top-2 right-2" />
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
