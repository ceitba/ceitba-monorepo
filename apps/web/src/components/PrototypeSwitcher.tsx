// PROTOTYPE ONLY: floating bar that cycles ?variant= on the current route.
// Renders nothing in production builds. Delete once the prototype is decided.
import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'

export interface PrototypeVariant { key: string; name: string }

export default function PrototypeSwitcher({ variants, children }: { variants: PrototypeVariant[]; children?: React.ReactNode }) {
  const [params, setParams] = useSearchParams()
  const current = params.get('variant') ?? variants[0].key
  const idx = Math.max(0, variants.findIndex((v) => v.key === current))

  const go = (delta: number) => {
    const next = variants[(idx + delta + variants.length) % variants.length]
    const p = new URLSearchParams(params)
    p.set('variant', next.key)
    setParams(p, { replace: true })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (e.key === 'ArrowLeft') go(-1)
      if (e.key === 'ArrowRight') go(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!import.meta.env.DEV) return null

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-3 rounded-full bg-black text-white px-3 py-2 shadow-2xl font-mono text-xs">
      <button type="button" onClick={() => go(-1)} className="w-8 h-8 rounded-full hover:bg-white/20" aria-label="Variante anterior">←</button>
      <span className="whitespace-nowrap">{variants[idx].key} · {variants[idx].name}</span>
      <button type="button" onClick={() => go(1)} className="w-8 h-8 rounded-full hover:bg-white/20" aria-label="Variante siguiente">→</button>
      {children && <span className="flex items-center gap-2 pl-3 border-l border-white/30">{children}</span>}
    </div>
  )
}
