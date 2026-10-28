// PROTOTYPE ONLY — throwaway. Question: what should comments + polls look like
// on a newsletter article? Three variants on the real ArticleDetailPage,
// switchable with ?variant=A|B|C (floating bar, ← →). All data is in memory;
// nothing talks to the API. Strings are hardcoded Spanish on purpose (no i18n
// for a mock). Delete once a variant wins.
import { useState, type ReactNode } from 'react'
import { Badge, Button, textareaClass } from '@/components/ui'
import PrototypeSwitcher from '@/components/PrototypeSwitcher'

// ── Mock data ────────────────────────────────────────────────────────────────

interface MockComment {
  id: string
  author: string
  initials: string
  org?: string           // set when the author writes as the article's org
  votedOption?: string   // poll option the author picked (variant C)
  minutesAgo: number
  body: string
  likes: number
  liked?: boolean
  pinned?: boolean
  replies?: MockComment[]
}

interface MockPoll {
  question: string
  options: { id: string; label: string; votes: number }[]
  closesIn: string
  myVote: string | null
  closed: boolean
}

const INITIAL_POLL: MockPoll = {
  question: '¿Qué horario preferís para la Semana de la Ingeniería?',
  options: [
    { id: 'm', label: 'Mañana (9 a 13)', votes: 84 },
    { id: 't', label: 'Tarde (14 a 18)', votes: 131 },
    { id: 'n', label: 'Noche (18 a 22)', votes: 57 },
    { id: 'x', label: 'Me da igual', votes: 19 },
  ],
  closesIn: 'Cierra en 3 días',
  myVote: null,
  closed: false,
}

const INITIAL_COMMENTS: MockComment[] = [
  {
    id: 'c0', author: 'CEITBA', initials: 'CE', org: 'CEITBA', minutesAgo: 30, pinned: true, likes: 22,
    body: 'Gracias a todos los que votaron. Vamos a publicar el cronograma definitivo el viernes con los resultados de la encuesta.',
  },
  {
    id: 'c1', author: 'Martina López', initials: 'ML', votedOption: 'Tarde (14 a 18)', minutesAgo: 95, likes: 14,
    body: 'Ojalá sea a la tarde, a la mañana se pisa con los parciales de Física II.',
    replies: [
      { id: 'c1r1', author: 'Tomás Rey', initials: 'TR', votedOption: 'Noche (18 a 22)', minutesAgo: 70, likes: 3, body: 'Para los que trabajan la noche es la única opción posible 😅' },
      { id: 'c1r2', author: 'CEITBA', initials: 'CE', org: 'CEITBA', minutesAgo: 40, likes: 8, body: 'Lo tenemos en cuenta: la idea es grabar las charlas principales.' },
    ],
  },
  {
    id: 'c2', author: 'Juan Pérez', initials: 'JP', votedOption: 'Mañana (9 a 13)', minutesAgo: 180, likes: 5,
    body: '¿Las charlas van a ser presenciales en Madero o en Distrito Tecnológico?',
  },
  {
    id: 'c3', author: 'Sofía Gómez', initials: 'SG', votedOption: 'Tarde (14 a 18)', minutesAgo: 60 * 26, likes: 2,
    body: 'Muy buena la nota. Sería genial que haya algo de robótica este año.',
  },
]

function ago(min: number) {
  if (min < 60) return `hace ${min} min`
  if (min < 60 * 24) return `hace ${Math.round(min / 60)} h`
  return `hace ${Math.round(min / 60 / 24)} d`
}

function countAll(cs: MockComment[]): number {
  return cs.reduce((n, c) => n + 1 + countAll(c.replies ?? []), 0)
}

// ── Shared mock state ────────────────────────────────────────────────────────

function useMockState() {
  const [poll, setPoll] = useState(INITIAL_POLL)
  const [comments, setComments] = useState(INITIAL_COMMENTS)
  const [signedIn, setSignedIn] = useState(true)
  const [commentsOpen, setCommentsOpen] = useState(true)

  const vote = (optionId: string) => setPoll((p) => {
    if (p.closed) return p
    const options = p.options.map((o) => ({
      ...o,
      votes: o.votes + (o.id === optionId ? 1 : 0) - (o.id === p.myVote ? 1 : 0),
    }))
    return { ...p, options, myVote: p.myVote === optionId ? null : optionId }
  })

  const toggleLike = (id: string) => {
    const walk = (cs: MockComment[]): MockComment[] => cs.map((c) =>
      c.id === id
        ? { ...c, liked: !c.liked, likes: c.likes + (c.liked ? -1 : 1) }
        : { ...c, replies: c.replies ? walk(c.replies) : undefined })
    setComments(walk)
  }

  const add = (body: string, parentId?: string) => {
    const myOption = poll.options.find((o) => o.id === poll.myVote)?.label
    const mine: MockComment = { id: crypto.randomUUID(), author: 'Vos', initials: 'VO', minutesAgo: 0, likes: 0, body, votedOption: myOption }
    if (!parentId) { setComments((cs) => [mine, ...cs]); return }
    setComments((cs) => cs.map((c) => c.id === parentId ? { ...c, replies: [...(c.replies ?? []), mine] } : c))
  }

  return { poll, setPoll, comments, signedIn, setSignedIn, commentsOpen, setCommentsOpen, vote, toggleLike, add }
}
type State = ReturnType<typeof useMockState>

// ── Small shared pieces ──────────────────────────────────────────────────────

function Avatar({ initials, org }: { initials: string; org?: string }) {
  return (
    <span className={[
      'shrink-0 w-9 h-9 rounded-full flex items-center justify-center font-mono text-[11px] font-semibold',
      org ? 'bg-primary text-white' : 'bg-primary-50 text-primary-700 dark:bg-night-raised dark:text-night-text',
    ].join(' ')}>{initials}</span>
  )
}

function Composer({ s, placeholder = 'Escribí un comentario…', onSent, compact = false }: { s: State; placeholder?: string; onSent?: () => void; compact?: boolean }) {
  const [text, setText] = useState('')
  if (!s.signedIn) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-dashed border-border dark:border-night-border px-4 py-3">
        <span className="font-body text-body-sm text-ink-secondary">Iniciá sesión con tu mail del ITBA para comentar.</span>
        <Button size="sm" variant="outline" onClick={() => s.setSignedIn(true)}>Iniciar sesión</Button>
      </div>
    )
  }
  return (
    <form
      className="flex gap-3"
      onSubmit={(e) => { e.preventDefault(); if (!text.trim()) return; s.add(text.trim()); setText(''); onSent?.() }}
    >
      {!compact && <Avatar initials="VO" />}
      <div className="flex-1 flex flex-col gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          maxLength={1000}
          className={textareaClass({ className: compact ? 'min-h-[64px]' : '' })}
        />
        <div className="flex items-center justify-between">
          <span className="font-mono text-label text-ink-secondary">{text.length}/1000 · se publica con tu nombre</span>
          <Button size="sm" type="submit" disabled={!text.trim()}>Comentar</Button>
        </div>
      </div>
    </form>
  )
}

function LikeButton({ c, s }: { c: MockComment; s: State }) {
  return (
    <button
      type="button"
      onClick={() => s.toggleLike(c.id)}
      aria-pressed={!!c.liked}
      className={['inline-flex items-center gap-1 font-mono text-label min-h-[32px]', c.liked ? 'text-primary' : 'text-ink-secondary hover:text-primary'].join(' ')}
    >
      ♥ {c.likes}
    </button>
  )
}

function Section({ id, title, children, aside }: { id: string; title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-12 pt-8 border-t border-border dark:border-night-border">
      <div className="flex items-baseline justify-between gap-4 mb-6">
        <h2 id={id} className="font-display text-h3 font-bold text-ink-primary">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

// Poll card used by A and B: options are buttons until you vote, then bars.
function PollCard({ s, dense = false }: { s: State; dense?: boolean }) {
  const { poll } = s
  const total = poll.options.reduce((n, o) => n + o.votes, 0)
  const showResults = poll.myVote !== null || poll.closed
  return (
    <div className={['rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface shadow-card', dense ? 'p-4' : 'p-6'].join(' ')}>
      <div className="flex items-center gap-2 mb-3">
        <Badge tone="accent">Encuesta</Badge>
        <span className="font-mono text-label text-ink-secondary">{poll.closed ? 'Cerrada' : poll.closesIn}</span>
      </div>
      <p className={['font-display font-bold text-ink-primary leading-snug mb-4', dense ? 'text-body' : 'text-h4'].join(' ')}>{poll.question}</p>
      <ul className="flex flex-col gap-2">
        {poll.options.map((o) => {
          const pct = total ? Math.round((o.votes / total) * 100) : 0
          const mine = poll.myVote === o.id
          return (
            <li key={o.id}>
              <button
                type="button"
                disabled={poll.closed || !s.signedIn}
                onClick={() => s.vote(o.id)}
                aria-pressed={mine}
                className={[
                  'relative w-full min-h-[44px] overflow-hidden rounded-xs border text-left px-3 py-2 font-body text-body-sm transition-colors',
                  mine ? 'border-primary' : 'border-border dark:border-night-border hover:border-primary',
                  'disabled:cursor-default',
                ].join(' ')}
              >
                {showResults && (
                  <span aria-hidden="true" className={['absolute inset-y-0 left-0', mine ? 'bg-primary-100 dark:bg-primary-900' : 'bg-primary-50 dark:bg-night-raised'].join(' ')} style={{ width: `${pct}%` }} />
                )}
                <span className="relative flex items-center justify-between gap-3">
                  <span className={mine ? 'font-semibold text-primary' : 'text-ink-primary'}>{mine && '✓ '}{o.label}</span>
                  {showResults && <span className="font-mono text-label text-ink-secondary">{pct}%</span>}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      <p className="mt-3 font-mono text-label text-ink-secondary">
        {total} votos{!s.signedIn && ' · iniciá sesión para votar'}{poll.myVote && !poll.closed && ' · tocá tu opción para cambiar el voto'}
      </p>
    </div>
  )
}

// ── Variant A: Al pie del artículo ───────────────────────────────────────────
// Poll embedded inside the body (the author places it where it makes sense),
// classic threaded comments below the vote bar, one level of replies.

function VariantA({ s, header, body, votes }: SlotProps & { s: State }) {
  const [sort, setSort] = useState<'top' | 'new'>('top')
  const sorted = [...s.comments].sort((a, b) =>
    (Number(!!b.pinned) - Number(!!a.pinned)) || (sort === 'top' ? b.likes - a.likes : a.minutesAgo - b.minutesAgo))
  return (
    <div className="max-w-2xl">
      {header}
      {body}
      <div className="my-10"><PollCard s={s} /></div>
      <p className="font-body text-body text-ink-primary leading-relaxed">
        (El autor eligió en el editor dónde va la encuesta: queda en medio del texto, como un bloque más.)
      </p>
      {votes}
      {s.commentsOpen ? (
        <Section
          id="comments-a"
          title={`Comentarios (${countAll(s.comments)})`}
          aside={(
            <div className="flex gap-1">
              {(['top', 'new'] as const).map((k) => (
                <button key={k} type="button" onClick={() => setSort(k)}
                  className={['font-mono text-label uppercase tracking-widest px-2 min-h-[32px] rounded-xs', sort === k ? 'bg-primary text-white' : 'text-ink-secondary hover:text-primary'].join(' ')}>
                  {k === 'top' ? 'Destacados' : 'Recientes'}
                </button>
              ))}
            </div>
          )}
        >
          <Composer s={s} />
          <ol className="mt-8 flex flex-col gap-8">
            {sorted.map((c) => <ThreadA key={c.id} c={c} s={s} />)}
          </ol>
        </Section>
      ) : <ClosedNotice />}
    </div>
  )
}

function ThreadA({ c, s, depth = 0 }: { c: MockComment; s: State; depth?: number }) {
  const [replying, setReplying] = useState(false)
  const [text, setText] = useState('')
  return (
    <li className="flex gap-3">
      <Avatar initials={c.initials} org={c.org} />
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <strong className="font-body text-body-sm font-semibold text-ink-primary">{c.author}</strong>
          {c.org && <Badge tone="info">Autor</Badge>}
          {c.pinned && <Badge tone="accent">Fijado</Badge>}
          <span className="font-mono text-label text-ink-secondary">{ago(c.minutesAgo)}</span>
        </div>
        <p className="mt-1 font-body text-body-sm text-ink-primary leading-relaxed">{c.body}</p>
        <div className="mt-1 flex items-center gap-4">
          <LikeButton c={c} s={s} />
          {depth === 0 && s.signedIn && (
            <button type="button" onClick={() => setReplying((r) => !r)} className="font-mono text-label text-ink-secondary hover:text-primary min-h-[32px]">Responder</button>
          )}
          <button type="button" className="font-mono text-label text-ink-secondary hover:text-red-600 min-h-[32px]">Reportar</button>
        </div>
        {replying && (
          <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { s.add(text.trim(), c.id); setText(''); setReplying(false) } }}>
            <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={`Responder a ${c.author}…`}
              className="flex-1 min-h-[40px] px-3 rounded-xs border border-border dark:border-night-border bg-white dark:bg-night-surface font-body text-body-sm" />
            <Button size="sm" type="submit">Enviar</Button>
          </form>
        )}
        {c.replies && c.replies.length > 0 && (
          <ol className="mt-4 flex flex-col gap-4 pl-4 border-l-2 border-border dark:border-night-border">
            {c.replies.map((r) => <ThreadA key={r.id} c={r} s={s} depth={1} />)}
          </ol>
        )}
      </div>
    </li>
  )
}

// ── Variant B: Columna lateral + panel ───────────────────────────────────────
// The article keeps its reading column; a sticky right rail carries the poll
// and a preview of the latest comments. The full conversation opens in a side
// panel so it never pushes the "More from…" section down.

function VariantB({ s, header, body, votes }: SlotProps & { s: State }) {
  const [panel, setPanel] = useState(false)
  const latest = [...s.comments].sort((a, b) => a.minutesAgo - b.minutesAgo).slice(0, 3)
  const n = countAll(s.comments)
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,42rem)_20rem] gap-10 xl:gap-16">
      <div>
        {header}
        {body}
        {votes}
        <div className="lg:hidden mt-10"><PollCard s={s} /></div>
        {s.commentsOpen && (
          <button type="button" onClick={() => setPanel(true)}
            className="mt-8 w-full flex items-center justify-between rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface px-5 py-4 hover:border-primary transition-colors">
            <span className="font-display text-h4 font-bold text-ink-primary">💬 {n} comentarios</span>
            <span className="font-mono text-label uppercase tracking-widest text-primary">Abrir conversación →</span>
          </button>
        )}
      </div>

      <aside className="hidden lg:flex flex-col gap-6 lg:sticky lg:top-24 self-start">
        <PollCard s={s} dense />
        {s.commentsOpen ? (
          <div className="rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface p-4">
            <p className="font-mono text-label uppercase tracking-widest text-ink-secondary mb-3">Últimos comentarios</p>
            <ul className="flex flex-col gap-4">
              {latest.map((c) => (
                <li key={c.id} className="flex gap-2">
                  <Avatar initials={c.initials} org={c.org} />
                  <div className="min-w-0">
                    <p className="font-body text-body-sm text-ink-primary line-clamp-2"><strong className="font-semibold">{c.author}</strong> {c.body}</p>
                    <span className="font-mono text-label text-ink-secondary">{ago(c.minutesAgo)}</span>
                  </div>
                </li>
              ))}
            </ul>
            <Button variant="outline" size="sm" block className="mt-4" onClick={() => setPanel(true)}>Ver los {n} comentarios</Button>
          </div>
        ) : <ClosedNotice />}
      </aside>

      {panel && (
        <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Comentarios">
          <button type="button" aria-label="Cerrar" className="absolute inset-0 bg-black/30" onClick={() => setPanel(false)} />
          <div className="relative w-full max-w-md h-full bg-surface dark:bg-night-bg shadow-card-hover flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border dark:border-night-border">
              <h2 className="font-display text-h4 font-bold text-ink-primary">{n} comentarios</h2>
              <Button variant="ghost" size="sm" onClick={() => setPanel(false)}>Cerrar</Button>
            </div>
            <ol className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-6">
              {s.comments.map((c) => <ThreadA key={c.id} c={c} s={s} />)}
            </ol>
            <div className="border-t border-border dark:border-night-border p-4 bg-white dark:bg-night-surface">
              <Composer s={s} compact />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Variant C: La pregunta primero ───────────────────────────────────────────
// The poll leads the article as "the question of this note"; results reveal
// after you vote. Comments are tied to it: each shows what the commenter voted,
// you can filter by option, and the org's pinned answer sits on top. No reply
// threads: a flat conversation.

function VariantC({ s, header, body, votes }: SlotProps & { s: State }) {
  const { poll } = s
  const total = poll.options.reduce((n, o) => n + o.votes, 0)
  const voted = poll.myVote !== null || poll.closed
  const [filter, setFilter] = useState<string | null>(null)
  const [composing, setComposing] = useState(false)
  const flat = s.comments.flatMap((c) => [c, ...(c.replies ?? [])])
  const pinned = flat.filter((c) => c.pinned)
  const rest = flat.filter((c) => !c.pinned && (!filter || c.votedOption === filter)).sort((a, b) => a.minutesAgo - b.minutesAgo)

  return (
    <div className="max-w-2xl">
      {header}

      <div className="mt-8 rounded-card bg-primary text-white p-6 lg:p-8">
        <p className="font-mono text-label uppercase tracking-widest text-accent">La pregunta de esta nota · {poll.closed ? 'cerrada' : poll.closesIn.toLowerCase()}</p>
        <p className="mt-2 font-display text-h3 font-bold leading-snug">{poll.question}</p>
        <div className={['mt-5 grid gap-2', voted ? 'grid-cols-1' : 'grid-cols-2'].join(' ')}>
          {poll.options.map((o) => {
            const pct = total ? Math.round((o.votes / total) * 100) : 0
            const mine = poll.myVote === o.id
            return voted ? (
              <button key={o.id} type="button" onClick={() => !poll.closed && s.vote(o.id)} className="text-left">
                <div className="flex justify-between font-body text-body-sm"><span className={mine ? 'font-semibold' : ''}>{mine && '✓ '}{o.label}</span><span className="font-mono">{pct}%</span></div>
                <div className="mt-1 h-2 rounded-full bg-white/15 overflow-hidden"><div className={mine ? 'h-full bg-accent' : 'h-full bg-white/60'} style={{ width: `${pct}%` }} /></div>
              </button>
            ) : (
              <button key={o.id} type="button" disabled={!s.signedIn} onClick={() => s.vote(o.id)}
                className="min-h-[52px] rounded-xs border border-white/30 hover:bg-white hover:text-primary transition-colors font-body text-body-sm font-semibold px-3 disabled:opacity-60">
                {o.label}
              </button>
            )
          })}
        </div>
        <p className="mt-4 font-mono text-label text-white/70">
          {voted ? `${total} votos` : s.signedIn ? 'Votá para ver los resultados' : 'Iniciá sesión para votar y ver los resultados'}
        </p>
      </div>

      {body}
      {votes}

      {s.commentsOpen ? (
        <Section id="comments-c" title="Qué opinan">
          {pinned.map((c) => (
            <div key={c.id} className="mb-6 rounded-card bg-accent-50 dark:bg-accent-900/30 border-l-4 border-accent p-4">
              <div className="flex items-center gap-2 mb-1">
                <Badge tone="accent">Respuesta de {c.org}</Badge>
                <span className="font-mono text-label text-ink-secondary">{ago(c.minutesAgo)}</span>
              </div>
              <p className="font-body text-body-sm text-ink-primary">{c.body}</p>
            </div>
          ))}

          <div className="flex flex-wrap gap-2 mb-6">
            <FilterChip active={filter === null} onClick={() => setFilter(null)}>Todos</FilterChip>
            {poll.options.map((o) => (
              <FilterChip key={o.id} active={filter === o.label} onClick={() => setFilter(o.label)}>{o.label}</FilterChip>
            ))}
          </div>

          {composing
            ? <Composer s={s} placeholder="Contá por qué votaste así…" onSent={() => setComposing(false)} />
            : <Button variant="outline" block onClick={() => setComposing(true)}>Sumate a la conversación</Button>}

          <ul className="mt-6 divide-y divide-border dark:divide-night-border">
            {rest.map((c) => (
              <li key={c.id} className="py-4 flex gap-3">
                <Avatar initials={c.initials} org={c.org} />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="font-body text-body-sm font-semibold text-ink-primary">{c.author}</strong>
                    {c.votedOption && <Badge tone="neutral">Votó: {c.votedOption}</Badge>}
                    <span className="font-mono text-label text-ink-secondary">{ago(c.minutesAgo)}</span>
                  </div>
                  <p className="mt-1 font-body text-body-sm text-ink-primary">{c.body}</p>
                  <LikeButton c={c} s={s} />
                </div>
              </li>
            ))}
            {rest.length === 0 && <li className="py-6 font-body text-body-sm text-ink-secondary">Nadie que votó esa opción comentó todavía.</li>}
          </ul>
        </Section>
      ) : <ClosedNotice />}
    </div>
  )
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={['font-mono text-label px-3 min-h-[36px] rounded-full border transition-colors',
        active ? 'bg-primary text-white border-primary' : 'border-border dark:border-night-border text-ink-secondary hover:border-primary hover:text-primary'].join(' ')}>
      {children}
    </button>
  )
}

function ClosedNotice() {
  return (
    <p className="mt-12 pt-8 border-t border-border dark:border-night-border font-body text-body-sm text-ink-secondary">
      Los comentarios están desactivados para esta nota.
    </p>
  )
}

// ── Entry ────────────────────────────────────────────────────────────────────

interface SlotProps { header: ReactNode; body: ReactNode; votes: ReactNode }

const VARIANTS = [
  { key: 'A', name: 'Al pie (clásico)' },
  { key: 'B', name: 'Columna lateral + panel' },
  { key: 'C', name: 'La pregunta primero' },
]

export default function EngagementPrototype({ variant, ...slots }: SlotProps & { variant: string }) {
  const s = useMockState()
  const toggle = (label: string, on: boolean, set: () => void) => (
    <button type="button" onClick={set} className={['px-2 py-1 rounded-full', on ? 'bg-white text-black' : 'bg-white/15'].join(' ')}>{label}</button>
  )
  return (
    <>
      {variant === 'B' ? <VariantB s={s} {...slots} /> : variant === 'C' ? <VariantC s={s} {...slots} /> : <VariantA s={s} {...slots} />}
      <PrototypeSwitcher variants={VARIANTS}>
        {toggle('Logueado', s.signedIn, () => s.setSignedIn(!s.signedIn))}
        {toggle('Encuesta cerrada', s.poll.closed, () => s.setPoll({ ...s.poll, closed: !s.poll.closed }))}
        {toggle('Comentarios', s.commentsOpen, () => s.setCommentsOpen(!s.commentsOpen))}
      </PrototypeSwitcher>
    </>
  )
}
