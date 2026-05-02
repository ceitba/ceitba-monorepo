import { useState } from 'react'
import CategoryBadge from './CategoryBadge'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate()
}

function getFirstWeekday(year, month) {
  return new Date(year, month, 1).getDay()
}

function isoDate(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function formatMonth(year, month) {
  return new Date(year, month, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })
}

export default function Calendar({ events, selectedDate, onSelectDate }) {
  const today = new Date()
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())

  const daysInMonth = getDaysInMonth(viewYear, viewMonth)
  const firstWeekday = getFirstWeekday(viewYear, viewMonth)

  // Build set of days that have events for fast lookup
  const eventDays = new Set(
    events
      .filter((e) => {
        const d = new Date(e.date)
        return d.getFullYear() === viewYear && d.getMonth() === viewMonth
      })
      .map((e) => new Date(e.date).getDate())
  )

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1) }
    else setViewMonth((m) => m - 1)
  }

  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear((y) => y + 1) }
    else setViewMonth((m) => m + 1)
  }

  const todayStr = isoDate(today.getFullYear(), today.getMonth(), today.getDate())

  return (
    <div className="bg-white rounded-card border border-border shadow-card select-none">
      {/* Month navigation */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <button
          type="button"
          onClick={prevMonth}
          aria-label="Previous month"
          className="w-9 h-9 flex items-center justify-center rounded text-ink-secondary hover:text-primary hover:bg-primary-50 transition-colors duration-150 focus-visible:rounded"
        >
          <ChevronLeft />
        </button>

        <h2 className="font-display text-h5 font-bold text-ink-primary tabular-nums">
          {formatMonth(viewYear, viewMonth)}
        </h2>

        <button
          type="button"
          onClick={nextMonth}
          aria-label="Next month"
          className="w-9 h-9 flex items-center justify-center rounded text-ink-secondary hover:text-primary hover:bg-primary-50 transition-colors duration-150 focus-visible:rounded"
        >
          <ChevronRight />
        </button>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 border-b border-border">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="py-2 text-center font-mono text-label text-ink-secondary uppercase tracking-widest"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7">
        {/* Leading empty cells */}
        {Array.from({ length: firstWeekday }).map((_, i) => (
          <div key={`empty-${i}`} className="h-12 border-b border-r border-border last:border-r-0" />
        ))}

        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1
          const dateStr = isoDate(viewYear, viewMonth, day)
          const hasEvents = eventDays.has(day)
          const isToday = dateStr === todayStr
          const isSelected = dateStr === selectedDate
          const colIndex = (firstWeekday + i) % 7

          return (
            <button
              key={day}
              type="button"
              onClick={() => onSelectDate(isSelected ? null : dateStr)}
              aria-label={`${dateStr}${hasEvents ? ', has events' : ''}`}
              aria-pressed={isSelected}
              className={[
                'h-12 flex flex-col items-center justify-center gap-0.5',
                'border-b border-r border-border transition-colors duration-100',
                colIndex === 6 ? 'border-r-0' : '',
                'focus-visible:z-10 focus-visible:relative',
                isSelected
                  ? 'bg-primary text-surface'
                  : isToday
                  ? 'bg-accent-50 text-primary font-bold'
                  : 'hover:bg-primary-50 text-ink-primary',
              ].join(' ')}
            >
              <span className="font-mono text-sm leading-none tabular-nums">{day}</span>
              {hasEvents && (
                <span
                  className={[
                    'w-1.5 h-1.5 rounded-full',
                    isSelected ? 'bg-accent' : 'bg-accent-400',
                  ].join(' ')}
                  aria-hidden="true"
                />
              )}
            </button>
          )
        })}

        {/* Trailing empty cells to complete the grid row */}
        {(() => {
          const totalCells = firstWeekday + daysInMonth
          const remainder = totalCells % 7
          const trailing = remainder === 0 ? 0 : 7 - remainder
          return Array.from({ length: trailing }).map((_, i) => (
            <div key={`trail-${i}`} className="h-12 border-b border-r border-border last:border-r-0" />
          ))
        })()}
      </div>
    </div>
  )
}

function ChevronLeft() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  )
}

function ChevronRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}
