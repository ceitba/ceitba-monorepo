import React, { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { TimeBlock } from '../types/scheduler'
import { WEEKDAYS } from '../services/time'
import { Button, Field, Modal, inputClass, selectClass, toast } from '@/components/ui'

// Controlled: the blocks live in the parent (CareerPage) so a restored
// saved schedule shows up here and edits never drop blocks the parent has.
interface WeeklyCalendarProps {
  blocks: TimeBlock[]
  onChange: (blocks: TimeBlock[]) => void
}

// Blocks on the same day never overlap, so day+range identifies one even
// when an old saved payload has no id.
const blockKey = (block: TimeBlock) => block.id ?? `${block.day}-${block.from}-${block.to}`

const FIRST_HOUR = 8
const LAST_HOUR = 22
const CELL = 32 // px per hour
const HOURS = LAST_HOUR - FIRST_HOUR
// Touch: holding this long without moving starts a drag; moving first
// scrolls the page as usual.
const LONG_PRESS_MS = 300
const MOVE_SLOP_PX = 10

const hh = (hour: number) => `${hour.toString().padStart(2, '0')}:00`
const hourOf = (time: string) => parseInt(time.split(':')[0], 10)

interface SelectionState {
  day: string
  startHour: number
  endHour: number
}

// The block a drag (or a click/tap) stands for: one hour from where it
// started, or the whole dragged range.
const rangeOf = (sel: SelectionState) => {
  if (Math.abs(sel.endHour - sel.startHour) <= 1) {
    const from = Math.min(sel.startHour, LAST_HOUR - 1)
    return { from, to: from + 1 }
  }
  return { from: Math.min(sel.startHour, sel.endHour), to: Math.max(sel.startHour, sel.endHour) }
}

const overlapsAny = (blocks: TimeBlock[], day: string, from: number, to: number, except?: TimeBlock) =>
  blocks.some((b) => {
    if (b.day !== day || (except && blockKey(b) === blockKey(except))) return false
    return from < hourOf(b.to) && to > hourOf(b.from)
  })

const getHourFromPosition = (y: number): number => {
  if (y >= HOURS * CELL - CELL / 2) return LAST_HOUR
  const hour = Math.floor(y / CELL) + FIRST_HOUR
  return Math.min(Math.max(hour, FIRST_HOUR), LAST_HOUR - 1)
}

// Add (no `block`) or edit a blocked time without dragging: day, from, to
// and an optional title.
const BlockFormModal: React.FC<{
  block: TimeBlock | null
  blocks: TimeBlock[]
  onSave: (block: TimeBlock) => void
  onDelete?: () => void
  onClose: () => void
}> = ({ block, blocks, onSave, onDelete, onClose }) => {
  const { t } = useTranslation()
  const [day, setDay] = useState(block?.day ?? WEEKDAYS[0])
  const [from, setFrom] = useState(block?.from ?? hh(FIRST_HOUR))
  const [to, setTo] = useState(block?.to ?? hh(FIRST_HOUR + 1))
  const [label, setLabel] = useState(block?.label ?? '')
  const [submitted, setSubmitted] = useState(false)

  const hours = Array.from({ length: HOURS + 1 }, (_, i) => hh(FIRST_HOUR + i))
  // Keep a non-hour value from an older payload selectable.
  const withValue = (list: string[], value: string) => (list.includes(value) ? list : [value, ...list])
  const fromOptions = withValue(hours.slice(0, -1), from)
  const toOptions = withValue(hours.slice(1), to)

  const error = from >= to
    ? t('settings.errors.order')
    : overlapsAny(blocks, day, hourOf(from), hourOf(to), block ?? undefined)
      ? t('settings.errors.overlap')
      : null

  const submit = () => {
    setSubmitted(true)
    if (error) return
    onSave({ ...(block ?? {}), id: block?.id ?? crypto.randomUUID(), day, from, to, label: label.trim() || undefined })
  }

  return (
    <Modal
      title={block ? t('settings.editBlock') : t('settings.addBlockedTime')}
      onClose={onClose}
      size="sm"
      footer={
        <>
          {onDelete && <Button variant="dangerGhost" onClick={onDelete} className="mr-auto">{t('settings.delete')}</Button>}
          <Button variant="ghost" onClick={onClose}>{t('ui.cancel')}</Button>
          <Button type="submit" form="blocked-time-form">{t('settings.save')}</Button>
        </>
      }
    >
      <form
        id="blocked-time-form"
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => { e.preventDefault(); submit() }}
      >
        <Field label={t('settings.day')}>
          {(p) => (
            <select {...p} value={day} onChange={(e) => setDay(e.target.value)} className={selectClass()}>
              {WEEKDAYS.map((d) => <option key={d} value={d}>{t(`daysFull.${d}`)}</option>)}
            </select>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('settings.from')}>
            {(p) => (
              <select {...p} value={from} onChange={(e) => setFrom(e.target.value)} className={selectClass({ invalid: submitted && !!error })}>
                {fromOptions.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            )}
          </Field>
          <Field label={t('settings.to')}>
            {(p) => (
              <select {...p} value={to} onChange={(e) => setTo(e.target.value)} className={selectClass({ invalid: submitted && !!error })}>
                {toOptions.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            )}
          </Field>
        </div>
        {submitted && error && (
          <p role="alert" className="-mt-2 font-body text-label text-red-600 dark:text-red-400">{error}</p>
        )}
        <Field label={t('settings.blockLabel')} hint={t('settings.blockLabelHint')}>
          {(p) => (
            <input
              {...p}
              type="text"
              value={label}
              maxLength={60}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t('settings.blockLabelPlaceholder')}
              className={inputClass()}
            />
          )}
        </Field>
      </form>
    </Modal>
  )
}

const WeeklyCalendar: React.FC<WeeklyCalendarProps> = ({ blocks: selectedBlocks, onChange }) => {
  const { t } = useTranslation()
  // null: closed; { block: null }: adding; { block }: editing that block.
  const [form, setForm] = useState<{ block: TimeBlock | null } | null>(null)
  const [selection, setSelectionState] = useState<SelectionState | null>(null)
  // Mirror of `selection` for the release handlers, which commit outside
  // of a state updater (updaters must stay pure).
  const selectionRef = useRef<SelectionState | null>(null)
  const setSelection = (next: SelectionState | null) => {
    selectionRef.current = next
    setSelectionState(next)
  }
  const calendarRef = useRef<HTMLDivElement>(null)
  // A touch on a day column: becomes a drag after a long press, or is
  // dropped (the page scrolls) if the finger moves first.
  const touchRef = useRef<{ day: string; x: number; y: number; el: HTMLElement; timer: number; dragging: boolean } | null>(null)

  const timeSlots = Array.from({ length: HOURS }, (_, i) => hh(i + FIRST_HOUR))

  const getBlocksForDay = (day: string): TimeBlock[] =>
    selectedBlocks.filter(block => block.day === day).sort((a, b) => hourOf(a.from) - hourOf(b.from))

  const selectionRange = selection ? rangeOf(selection) : null
  const selectionOverlaps = !!(selection && selectionRange &&
    overlapsAny(selectedBlocks, selection.day, selectionRange.from, selectionRange.to))

  // Adds the block a finished drag/click stands for, unless it would
  // overlap an existing one (then says so).
  const commit = useCallback((sel: SelectionState) => {
    const { from, to } = rangeOf(sel)
    if (overlapsAny(selectedBlocks, sel.day, from, to)) {
      toast.info(t('settings.overlapNotAdded'))
      return
    }
    onChange([...selectedBlocks, { id: crypto.randomUUID(), day: sel.day, from: hh(from), to: hh(to) }])
  }, [selectedBlocks, onChange, t])

  const hourAt = (el: HTMLElement, clientY: number) => getHourFromPosition(clientY - el.getBoundingClientRect().top)

  // Mouse: press on a column, drag, release anywhere.
  const handleMouseDown = (day: string, e: React.MouseEvent<HTMLElement>) => {
    if (e.button !== 0) return
    const hour = hourAt(e.currentTarget, e.clientY)
    setSelection({ day, startHour: hour, endHour: hour })
  }

  // On the column (not the overlay) so moving over an existing block keeps
  // updating the selection.
  const handleMouseMove = (day: string, e: React.MouseEvent<HTMLElement>) => {
    const sel = selectionRef.current
    if (!sel || touchRef.current || day !== sel.day) return
    const hour = hourAt(e.currentTarget, e.clientY)
    if (hour !== sel.endHour) setSelection({ ...sel, endHour: hour })
  }

  const finishSelection = useCallback(() => {
    const sel = selectionRef.current
    if (!sel) return
    selectionRef.current = null
    setSelectionState(null)
    commit(sel)
  }, [commit])

  const handleMouseUp = useCallback(() => {
    if (!touchRef.current) finishSelection()
  }, [finishSelection])

  useEffect(() => {
    window.addEventListener('mouseup', handleMouseUp)
    return () => window.removeEventListener('mouseup', handleMouseUp)
  }, [handleMouseUp])

  // React's touchmove listeners are passive, so the page scroll can only be
  // stopped from a native listener, and only while a drag is in progress.
  useEffect(() => {
    const calendar = calendarRef.current
    if (!calendar) return
    const preventScroll = (e: TouchEvent) => { if (touchRef.current?.dragging) e.preventDefault() }
    calendar.addEventListener('touchmove', preventScroll, { passive: false })
    return () => calendar.removeEventListener('touchmove', preventScroll)
  }, [])

  useEffect(() => () => { if (touchRef.current) window.clearTimeout(touchRef.current.timer) }, [])

  const handleTouchStart = (day: string, e: React.TouchEvent<HTMLElement>) => {
    if (e.touches.length !== 1) return
    const touch = e.touches[0]
    const el = e.currentTarget
    const y = touch.clientY
    const timer = window.setTimeout(() => {
      const current = touchRef.current
      if (!current) return
      current.dragging = true
      const hour = hourAt(el, current.y)
      setSelection({ day, startHour: hour, endHour: hour })
      navigator.vibrate?.(10)
    }, LONG_PRESS_MS)
    touchRef.current = { day, x: touch.clientX, y, el, timer, dragging: false }
  }

  const handleTouchMove = (e: React.TouchEvent<HTMLElement>) => {
    const current = touchRef.current
    if (!current) return
    const touch = e.touches[0]
    if (!current.dragging) {
      if (Math.hypot(touch.clientX - current.x, touch.clientY - current.y) > MOVE_SLOP_PX) {
        // A scroll, not a drag.
        window.clearTimeout(current.timer)
        touchRef.current = null
      }
      return
    }
    const hour = hourAt(current.el, touch.clientY)
    const sel = selectionRef.current
    if (sel && sel.endHour !== hour) setSelection({ ...sel, endHour: hour })
  }

  const handleTouchEnd = (e: React.TouchEvent<HTMLElement>) => {
    const current = touchRef.current
    touchRef.current = null
    if (!current) return
    window.clearTimeout(current.timer)
    // Handled here: keep the browser from also firing mouse events.
    e.preventDefault()
    if (current.dragging) {
      finishSelection()
    } else {
      // A tap blocks one hour, like a click.
      const hour = hourAt(current.el, current.y)
      commit({ day: current.day, startHour: hour, endHour: hour })
    }
  }

  const handleTouchCancel = () => {
    if (touchRef.current) window.clearTimeout(touchRef.current.timer)
    touchRef.current = null
    setSelection(null)
  }

  const saveBlock = (saved: TimeBlock) => {
    const editing = form?.block
    onChange(editing
      ? selectedBlocks.map(block => (blockKey(block) === blockKey(editing) ? saved : block))
      : [...selectedBlocks, saved])
    setForm(null)
  }

  const deleteBlock = (target: TimeBlock) => {
    onChange(selectedBlocks.filter(block => blockKey(block) !== blockKey(target)))
    setForm(null)
  }

  const getBlockColor = (key: string) => {
    const index = (selectedBlocks.findIndex(b => blockKey(b) === key) % 10) + 1
    return `bg-subject_color_${index}`
  }

  return (
    <div className="bg-white dark:bg-night-surface rounded-card border border-border dark:border-night-border px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3 pb-2">
        <h2 className="font-body font-semibold text-body text-ink-primary dark:text-night-text">
          {t('settings.blockedTimes')}
        </h2>
        <Button variant="outline" size="sm" onClick={() => setForm({ block: null })}>
          + {t('settings.addBlockedTime')}
        </Button>
      </div>
      <div className="font-body text-body-sm text-ink-secondary dark:text-night-muted mb-4">
        {t('settings.blockedTimesDescription')}
        <div className="space-y-2 mt-3">
          {([
            ['settings.blockedReason1Title', 'settings.blockedReason1Desc'],
            ['settings.blockedReason2Title', 'settings.blockedReason2Desc'],
            ['settings.blockedReason3Title', 'settings.blockedReason3Desc'],
          ] as const).map(([titleKey, descKey]) => (
            <div key={titleKey} className="flex items-start gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              <div>
                <span className="font-semibold text-ink-primary dark:text-night-text">{t(titleKey)}</span>
                <span className="text-ink-secondary dark:text-night-muted"> — {t(descKey)}</span>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3">{t('settings.howToBlock')}</p>
      </div>

      <div className="w-full select-none [-webkit-touch-callout:none]" ref={calendarRef}>
        <div className="w-full">
          {/* Header */}
          <div className="grid grid-cols-[auto_1fr_1fr_1fr_1fr_1fr] gap-0.5 mb-0.5">
            <div className="h-8 flex items-center justify-start font-mono text-label text-ink-secondary dark:text-night-muted min-w-[40px]">
              {t('settings.hour')}
            </div>
            {WEEKDAYS.map((day) => (
              <div
                key={day}
                className="h-8 flex items-center text-center justify-center font-mono text-label text-ink-secondary dark:text-night-muted bg-surface dark:bg-night-bg rounded-xs"
              >
                {t(`days.${day}`)}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-[auto_1fr_1fr_1fr_1fr_1fr] gap-0.5">
            {/* Time labels */}
            <div>
              {timeSlots.map((time) => (
                <div key={time} className="h-8 flex items-center font-mono text-label text-ink-secondary dark:text-night-muted min-w-[40px]">
                  {time}
                </div>
              ))}
            </div>

            {/* Day columns */}
            {WEEKDAYS.map((day) => (
              <div
                key={day}
                className="relative bg-surface dark:bg-night-bg rounded-xs"
                style={{ height: HOURS * CELL }}
                onMouseMove={(e) => handleMouseMove(day, e)}
              >
                {timeSlots.map((_, index) => (
                  <div
                    key={index}
                    className="absolute w-full border-b border-border/50 dark:border-night-border/50"
                    style={{ top: `${index * CELL}px`, height: `${CELL}px` }}
                  />
                ))}

                <div
                  className="absolute inset-0 cursor-pointer"
                  aria-hidden="true"
                  onMouseDown={(e) => handleMouseDown(day, e)}
                  onTouchStart={(e) => handleTouchStart(day, e)}
                  onTouchMove={handleTouchMove}
                  onTouchEnd={handleTouchEnd}
                  onTouchCancel={handleTouchCancel}
                />

                {getBlocksForDay(day).map((block) => {
                  const top = (hourOf(block.from) - FIRST_HOUR) * CELL
                  const height = (hourOf(block.to) - hourOf(block.from)) * CELL
                  const range = `${block.from} - ${block.to}`
                  return (
                    // Pastel subject colors in both themes, so the text stays ink.
                    <button
                      key={blockKey(block)}
                      type="button"
                      onClick={() => setForm({ block })}
                      aria-label={t('settings.editBlockAria', { day: t(`daysFull.${block.day}`), range, label: block.label ?? '' })}
                      className={`absolute inset-x-0 flex items-center justify-center gap-1 hover:brightness-95 text-ink-primary cursor-pointer transition-[filter] px-1 z-10 select-none ${getBlockColor(blockKey(block))}`}
                      style={{
                        top: `${top}px`,
                        height: `${height}px`,
                        borderRadius: top === 0 ? '6px 6px 0 0' : top + height === HOURS * CELL ? '0 0 6px 6px' : '0'
                      }}
                    >
                      <span className="flex flex-col items-center justify-center min-w-0 flex-1">
                        {block.label && (
                          <span className="font-body text-body-sm font-semibold truncate w-full text-center">{block.label}</span>
                        )}
                        <span className="font-mono text-label text-ink-primary/80 w-full text-center">{range}</span>
                      </span>
                      <svg
                        width="14" height="14" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                        className="shrink-0 text-ink-primary/70"
                        aria-hidden="true"
                      >
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                  )
                })}

                {selection && selectionRange && selection.day === day && (
                  <div
                    aria-hidden="true"
                    className={`absolute inset-x-0 z-20 pointer-events-none flex flex-col items-center justify-center text-center rounded-xs ${
                      selectionOverlaps
                        ? 'bg-red-100/90 border-2 border-dashed border-red-400 text-red-800'
                        : 'bg-primary-100 text-ink-primary'
                    }`}
                    style={{
                      top: `${(selectionRange.from - FIRST_HOUR) * CELL}px`,
                      height: `${(selectionRange.to - selectionRange.from) * CELL}px`,
                    }}
                  >
                    <span className="font-mono text-label">{`${hh(selectionRange.from)} - ${hh(selectionRange.to)}`}</span>
                    {selectionOverlaps && <span className="font-body text-label font-semibold">{t('settings.overlapsBlock')}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {form && (
        <BlockFormModal
          block={form.block}
          blocks={selectedBlocks}
          onSave={saveBlock}
          onDelete={form.block ? () => deleteBlock(form.block!) : undefined}
          onClose={() => setForm(null)}
        />
      )}
    </div>
  )
}

export default WeeklyCalendar
