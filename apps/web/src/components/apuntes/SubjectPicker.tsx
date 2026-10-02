import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchApunteSubjects, fetchMyPlanSubjects, type ApunteSubject } from '../../api/drive'
import { useDebounced } from '../../hooks/useDebounced'
import { INPUT } from './buttons'

export interface SubjectRef {
  id: string
  name: string
}

interface Props {
  // Explicit subject on this item (null → inherits).
  value: SubjectRef | null
  // Subject inherited from an ancestor folder, shown muted when no value.
  inherited: SubjectRef | null
  // subjectId "" clears the explicit subject.
  onChange: (subjectId: string, subject: SubjectRef | null) => void
  disabled?: boolean
  label: string
}

// The student's plan rarely changes within a visit: fetch it once per page
// load (shared by every picker in the tree). A failure is not cached.
let planPromise: Promise<ApunteSubject[]> | null = null
function loadPlan(): Promise<ApunteSubject[]> {
  if (!planPromise) {
    planPromise = fetchMyPlanSubjects().catch((e) => { planPromise = null; throw e })
  }
  return planPromise
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

interface Entry {
  subject: ApunteSubject
  // Group heading rendered before this entry.
  heading?: string
}

// Searchable subject combobox. Open with no query it lists the student's
// plan ("De tu plan", by year; GET /wiki/apuntes/subjects?mine=true); typing
// shows matching plan subjects first, then a search across all subjects
// (?q=). Closed it reads like a value.
export default function SubjectPicker({ value, inherited, onChange, disabled, label }: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<ApunteSubject[]>([])
  const [plan, setPlan] = useState<ApunteSubject[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [active, setActive] = useState(0)
  const debounced = useDebounced(query, 250)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const reqRef = useRef(0)

  useEffect(() => {
    if (!open || plan) return
    let cancelled = false
    loadPlan().then((p) => { if (!cancelled) setPlan(p) }).catch(() => { if (!cancelled) setPlan([]) })
    return () => { cancelled = true }
  }, [open, plan])

  useEffect(() => {
    if (!open) return
    const id = ++reqRef.current
    setLoading(true)
    setFailed(false)
    fetchApunteSubjects(debounced, 20)
      .then((res) => { if (reqRef.current === id) { setOptions(res); setActive(0) } })
      .catch(() => { if (reqRef.current === id) { setOptions([]); setFailed(true) } })
      .finally(() => { if (reqRef.current === id) setLoading(false) })
  }, [open, debounced])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function openPicker() {
    if (disabled) return
    setQuery('')
    setOpen(true)
    // Focus after the input mounts.
    window.setTimeout(() => inputRef.current?.focus(), 0)
  }

  const q = normalize(query.trim())
  const planList = plan ?? []
  const planMatches = q
    ? planList.filter((s) => normalize(s.subjectId).includes(q) || normalize(s.subjectName).includes(q))
    : planList
  const planIds = new Set(planMatches.map((s) => s.subjectId))
  const others = options.filter((s) => !planIds.has(s.subjectId))
  const entries: Entry[] = []
  let lastYear: number | null | undefined
  planMatches.forEach((s, i) => {
    const parts: string[] = []
    if (i === 0) parts.push(t('apuntes.picker.fromPlan'))
    if (!q && s.year != null && s.year !== lastYear) parts.push(t('apuntes.picker.planYear', { year: s.year }))
    lastYear = s.year
    entries.push({ subject: s, heading: parts.length ? parts.join(' · ') : undefined })
  })
  // With no query and a plan, the plan is the list; without a plan fall back
  // to the API's default (subjects with recent notes).
  if (q || planList.length === 0) {
    others.forEach((s, i) => entries.push({
      subject: s,
      heading: i === 0 && planMatches.length > 0 ? t('apuntes.picker.allSubjects') : undefined,
    }))
  }

  // Index 0 is "inherit" when there is an explicit value to clear.
  const clearable = value != null
  const total = entries.length + (clearable ? 1 : 0)

  function choose(index: number) {
    if (clearable && index === 0) {
      onChange('', null)
    } else {
      const o = entries[index - (clearable ? 1 : 0)]?.subject
      if (!o) return
      onChange(o.subjectId, { id: o.subjectId, name: o.subjectName })
    }
    setOpen(false)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(total - 1, a + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (total > 0) choose(active) }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
  }

  return (
    <div ref={rootRef} className="relative w-full sm:w-64">
      {!open ? (
        <button
          type="button"
          disabled={disabled}
          onClick={openPicker}
          aria-label={label}
          className="w-full min-h-[36px] px-3 py-1.5 rounded-sm border border-border dark:border-night-border bg-white dark:bg-night-surface text-left font-body text-body-sm flex items-center gap-2 hover:border-primary transition-colors disabled:opacity-50"
        >
          <span className="flex-1 min-w-0 truncate">
            {value ? (
              <span className="text-ink-primary dark:text-night-text">
                <span className="font-mono text-label text-ink-secondary dark:text-night-muted mr-1">{value.id}</span>
                {value.name}
              </span>
            ) : inherited ? (
              <span className="text-ink-secondary dark:text-night-muted italic">
                {t('apuntes.picker.inherited', { name: inherited.name })}
              </span>
            ) : (
              <span className="text-ink-secondary dark:text-night-muted">{t('apuntes.picker.none')}</span>
            )}
          </span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true" className="text-ink-secondary dark:text-night-muted flex-shrink-0">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      ) : (
        <>
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-label={label}
            aria-activedescendant={total > 0 ? `${listId}-${active}` : undefined}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('apuntes.picker.search')}
            className={`${INPUT} min-h-[36px] py-1.5`}
          />
          <ul
            id={listId}
            role="listbox"
            className="absolute z-30 left-0 right-0 mt-1 max-h-64 overflow-y-auto bg-white dark:bg-night-surface border border-border dark:border-night-border rounded-card shadow-card-hover py-1"
          >
            {clearable && (
              <li
                id={`${listId}-0`}
                role="option"
                aria-selected={active === 0}
                onMouseDown={(e) => { e.preventDefault(); choose(0) }}
                onMouseEnter={() => setActive(0)}
                className={`px-3 py-2 cursor-pointer font-body text-body-sm italic text-ink-secondary dark:text-night-muted ${active === 0 ? 'bg-primary-50 dark:bg-primary-900' : ''}`}
              >
                {inherited ? t('apuntes.picker.clearInherit', { name: inherited.name }) : t('apuntes.picker.clear')}
              </li>
            )}
            {entries.map(({ subject: o, heading }, i) => {
              const idx = i + (clearable ? 1 : 0)
              return [
                heading && (
                  <li
                    key={`h-${o.subjectId}`}
                    role="presentation"
                    className="px-3 pt-2 pb-1 font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted"
                  >
                    {heading}
                  </li>
                ),
                <li
                  key={o.subjectId}
                  id={`${listId}-${idx}`}
                  role="option"
                  aria-selected={active === idx}
                  onMouseDown={(e) => { e.preventDefault(); choose(idx) }}
                  onMouseEnter={() => setActive(idx)}
                  className={`px-3 py-2 cursor-pointer font-body text-body-sm text-ink-primary dark:text-night-text ${active === idx ? 'bg-primary-50 dark:bg-primary-900' : ''}`}
                >
                  <span className="font-mono text-label text-ink-secondary dark:text-night-muted mr-1">{o.subjectId}</span>
                  {o.subjectName}
                </li>,
              ]
            })}
            {loading && entries.length === 0 && (
              <li className="px-3 py-2 font-body text-body-sm text-ink-secondary dark:text-night-muted">{t('manage.loading')}</li>
            )}
            {!loading && failed && (
              <li className="px-3 py-2 font-body text-body-sm text-red-600 dark:text-red-400">{t('apuntes.picker.failed')}</li>
            )}
            {!loading && !failed && entries.length === 0 && (
              <li className="px-3 py-2 font-body text-body-sm text-ink-secondary dark:text-night-muted">
                {query.trim() ? t('apuntes.picker.noMatches') : t('apuntes.picker.typeToSearch')}
              </li>
            )}
          </ul>
        </>
      )}
    </div>
  )
}
