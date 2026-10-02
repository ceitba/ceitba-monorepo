import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchApunteSubjects, type ApunteSubject } from '../../api/drive'
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

// Searchable subject combobox fed by GET /wiki/apuntes/subjects?q=.
// Closed it reads like a value; open it is an input with a listbox.
export default function SubjectPicker({ value, inherited, onChange, disabled, label }: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<ApunteSubject[]>([])
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [active, setActive] = useState(0)
  const debounced = useDebounced(query, 250)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const reqRef = useRef(0)

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

  // Index 0 is "inherit" when there is an explicit value to clear.
  const clearable = value != null
  const total = options.length + (clearable ? 1 : 0)

  function choose(index: number) {
    if (clearable && index === 0) {
      onChange('', null)
    } else {
      const o = options[index - (clearable ? 1 : 0)]
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
            {options.map((o, i) => {
              const idx = i + (clearable ? 1 : 0)
              return (
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
                </li>
              )
            })}
            {loading && options.length === 0 && (
              <li className="px-3 py-2 font-body text-body-sm text-ink-secondary dark:text-night-muted">{t('manage.loading')}</li>
            )}
            {!loading && failed && (
              <li className="px-3 py-2 font-body text-body-sm text-red-600 dark:text-red-400">{t('apuntes.picker.failed')}</li>
            )}
            {!loading && !failed && options.length === 0 && (
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
