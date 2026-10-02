import type { FileKind } from '../../api/drive'

// Inline file-kind glyphs (no icon library, per the editorial system).
// Colour hints the kind the way Drive does, but muted.
const COLORS: Record<FileKind, string> = {
  FOLDER:  'text-accent-600 dark:text-accent-300',
  DOC:     'text-primary-400 dark:text-primary-300',
  SLIDES:  'text-amber-600 dark:text-amber-400',
  SHEET:   'text-emerald-700 dark:text-emerald-400',
  DRAWING: 'text-violet-600 dark:text-violet-400',
  PDF:     'text-red-600 dark:text-red-400',
  IMAGE:   'text-sky-700 dark:text-sky-400',
  OFFICE:  'text-primary-600 dark:text-primary-300',
  OTHER:   'text-ink-secondary dark:text-night-muted',
}

export default function KindIcon({ kind, size = 18, className = '' }: { kind: FileKind; size?: number; className?: string }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    className: `flex-shrink-0 ${COLORS[kind] ?? COLORS.OTHER} ${className}`,
  }
  switch (kind) {
    case 'FOLDER':
      return (
        <svg {...common}>
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
      )
    case 'SLIDES':
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="13" rx="1.5" />
          <line x1="12" y1="17" x2="12" y2="21" />
          <line x1="8" y1="21" x2="16" y2="21" />
        </svg>
      )
    case 'SHEET':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="18" height="18" rx="1.5" />
          <line x1="3" y1="9" x2="21" y2="9" />
          <line x1="3" y1="15" x2="21" y2="15" />
          <line x1="9" y1="9" x2="9" y2="21" />
        </svg>
      )
    case 'IMAGE':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="18" height="18" rx="1.5" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
      )
    case 'DRAWING':
      return (
        <svg {...common}>
          <path d="M12 19l7-7 3 3-7 7-3-3z" />
          <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
          <circle cx="11" cy="11" r="2" />
        </svg>
      )
    case 'PDF':
      return (
        <svg {...common}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <text x="12" y="17.5" textAnchor="middle" fontSize="6" fontWeight="700" stroke="none" fill="currentColor">PDF</text>
        </svg>
      )
    case 'DOC':
    case 'OFFICE':
      return (
        <svg {...common}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="8" y1="13" x2="16" y2="13" />
          <line x1="8" y1="17" x2="14" y2="17" />
        </svg>
      )
    default:
      return (
        <svg {...common}>
          <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
          <polyline points="13 2 13 9 20 9" />
        </svg>
      )
  }
}
