import { useState, useEffect, useMemo } from 'react'
import { fetchAnalyticsSummary } from '../../api/analytics'

const RANGES = [
  { label: '7 días',  days: 7  },
  { label: '30 días', days: 30 },
  { label: 'Todo',    days: null },
]

const EMPTY_SUMMARY = {
  totalArticleViews: 0,
  uniqueVisitors:    0,
  topArticles:       [],
  categoryViews:     [],
  dailyViews:        [],
  voteBreakdown:     [],
}

export default function AdminAnalyticsPage() {
  const [days, setDays]       = useState(30)
  const [summary, setSummary] = useState(EMPTY_SUMMARY)
  const [status, setStatus]   = useState('loading')

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    fetchAnalyticsSummary(days)
      .then((data) => { if (!cancelled) { setSummary(data); setStatus('success') } })
      .catch(() => { if (!cancelled) setStatus('error') })
    return () => { cancelled = true }
  }, [days])

  const totalVotes = useMemo(
    () => summary.voteBreakdown.reduce((s, v) => s + v.up + v.down, 0),
    [summary.voteBreakdown],
  )

  const articleRows = useMemo(() => {
    const voteMap = Object.fromEntries(
      summary.voteBreakdown.map((v) => [v.articleId, { up: v.up, down: v.down }]),
    )
    return summary.topArticles.map((a) => ({
      id:    a.articleId,
      title: a.title,
      views: a.views,
      votes: voteMap[a.articleId] ?? { up: 0, down: 0 },
    }))
  }, [summary])

  const catData = useMemo(
    () => summary.categoryViews.map(({ category, views }) => ({ label: category, value: views })),
    [summary.categoryViews],
  )

  const sparkData = useMemo(() => {
    const viewsMap = Object.fromEntries(summary.dailyViews.map(({ date, views }) => [date, views]))
    const today = new Date()
    return Array.from({ length: 14 }, (_, i) => {
      const d = new Date(today)
      d.setDate(d.getDate() - (13 - i))
      const key = d.toISOString().slice(0, 10)
      return { date: key, value: viewsMap[key] ?? 0 }
    })
  }, [summary.dailyViews])

  const sparkMax = Math.max(...sparkData.map((d) => d.value), 1)
  const noData   = summary.totalArticleViews === 0

  return (
    <div className="flex flex-col gap-8">
      {/* Header + range picker */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-h3 font-bold text-ink-primary">Analíticas</h1>
          <p className="font-body text-body-sm text-ink-secondary mt-0.5">
            Rendimiento del contenido para el equipo de medios.
          </p>
        </div>
        <RangePicker active={days} onChange={setDays} />
      </div>

      {status === 'error' && (
        <div className="bg-red-50 border border-red-200 rounded-card px-5 py-4">
          <p className="font-body text-body-sm text-red-800">
            No se pudieron cargar las analíticas. Intentá de nuevo más tarde.
          </p>
        </div>
      )}

      {status !== 'error' && noData && (
        <div className="bg-amber-50 border border-amber-200 rounded-card px-5 py-4">
          <p className="font-body text-body-sm text-amber-800">
            <strong>Sin datos aún.</strong> Los datos se registran cuando los lectores visitan artículos y votan.
          </p>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard label="Vistas de artículos" value={summary.totalArticleViews} icon={<IconEye />}  loading={status === 'loading'} />
        <StatCard label="Visitantes únicos"   value={summary.uniqueVisitors}    icon={<IconUser />} loading={status === 'loading'} />
        <StatCard label="Votos totales"       value={totalVotes}                icon={<IconThumb />} loading={status === 'loading'} />
      </div>

      {/* Sparkline — daily views */}
      <div className="bg-white rounded-card border border-border shadow-card p-5">
        <p className="font-mono text-label uppercase tracking-widest text-ink-secondary mb-4">
          Vistas diarias — últimos 14 días
        </p>
        <div className="flex items-end gap-1 h-20">
          {sparkData.map(({ date, value }) => (
            <div key={date} className="flex-1 flex flex-col items-center gap-1 group" title={`${date}: ${value}`}>
              <div
                className="w-full bg-primary-200 group-hover:bg-primary transition-colors duration-150 rounded-sm"
                style={{ height: `${Math.max(4, (value / sparkMax) * 100)}%` }}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-between mt-1">
          <span className="font-mono text-label text-border">{sparkData[0]?.date?.slice(5)}</span>
          <span className="font-mono text-label text-border">{sparkData[13]?.date?.slice(5)}</span>
        </div>
      </div>

      {/* Two-column: top articles + category breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-card border border-border shadow-card p-5">
          <p className="font-mono text-label uppercase tracking-widest text-ink-secondary mb-4">
            Artículos más vistos
          </p>
          {articleRows.filter((a) => a.views > 0).length === 0 ? (
            <EmptyMetric label="Sin visitas registradas aún." />
          ) : (
            <BarChart
              data={articleRows.filter((a) => a.views > 0).map((a) => ({ label: a.title, value: a.views }))}
              colorClass="bg-primary"
            />
          )}
        </div>

        <div className="bg-white rounded-card border border-border shadow-card p-5">
          <p className="font-mono text-label uppercase tracking-widest text-ink-secondary mb-4">
            Vistas por categoría
          </p>
          {catData.length === 0 ? (
            <EmptyMetric label="Sin datos de categoría aún." />
          ) : (
            <BarChart data={catData} colorClass="bg-accent-400" />
          )}
        </div>
      </div>

      {/* Vote breakdown table */}
      <div className="bg-white rounded-card border border-border shadow-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <p className="font-mono text-label uppercase tracking-widest text-ink-secondary">
            Votos por artículo
          </p>
          <p className="font-body text-body-sm text-ink-secondary mt-0.5">
            Los conteos son privados y no se muestran al público.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[540px]">
            <thead>
              <tr className="border-b border-border bg-surface">
                <VTh>Artículo</VTh>
                <VTh>▲ Útil</VTh>
                <VTh>▼ No útil</VTh>
                <VTh>Ratio</VTh>
                <VTh>Vistas</VTh>
              </tr>
            </thead>
            <tbody>
              {articleRows.map((a) => {
                const total = a.votes.up + a.votes.down
                const ratio = total > 0 ? Math.round((a.votes.up / total) * 100) : null
                return (
                  <tr key={a.id} className="border-b border-border last:border-b-0 hover:bg-surface">
                    <td className="px-4 py-3">
                      <span className="font-body text-body-sm text-ink-primary line-clamp-1">{a.title}</span>
                    </td>
                    <td className="px-4 py-3 font-mono text-label text-emerald-600">{a.votes.up}</td>
                    <td className="px-4 py-3 font-mono text-label text-red-500">{a.votes.down}</td>
                    <td className="px-4 py-3">
                      {ratio !== null ? (
                        <span className={['font-mono text-label', ratio >= 70 ? 'text-emerald-600' : ratio >= 40 ? 'text-amber-600' : 'text-red-500'].join(' ')}>
                          {ratio}%
                        </span>
                      ) : (
                        <span className="font-mono text-label text-border">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-label text-ink-secondary">{a.views}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────

function RangePicker({ active, onChange }) {
  return (
    <div className="flex rounded-sm border border-border overflow-hidden">
      {RANGES.map(({ label, days }) => (
        <button
          key={label}
          type="button"
          onClick={() => onChange(days)}
          className={[
            'min-h-[36px] px-3 font-mono text-label uppercase tracking-widest transition-colors duration-150',
            active === days ? 'bg-primary text-white' : 'text-ink-secondary hover:bg-surface',
          ].join(' ')}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function StatCard({ label, value, icon, loading }) {
  return (
    <div className="bg-white rounded-card border border-border shadow-card p-5 flex flex-col gap-2">
      <div className="w-8 h-8 text-primary">{icon}</div>
      {loading ? (
        <div className="skeleton h-8 w-20 rounded" />
      ) : (
        <p className="font-display text-h3 font-bold text-ink-primary tabular-nums">{value.toLocaleString()}</p>
      )}
      <p className="font-mono text-label text-ink-secondary uppercase tracking-widest">{label}</p>
    </div>
  )
}

function BarChart({ data, colorClass }) {
  const max = Math.max(...data.map((d) => d.value), 1)
  return (
    <div className="flex flex-col gap-3">
      {data.map(({ label, value }) => (
        <div key={label} className="flex items-center gap-3">
          <span className="w-32 font-body text-body-sm text-ink-secondary truncate text-right flex-shrink-0" title={label}>
            {label}
          </span>
          <div className="flex-1 bg-surface rounded-full h-2.5">
            <div
              className={['h-2.5 rounded-full transition-all duration-500', colorClass].join(' ')}
              style={{ width: `${(value / max) * 100}%` }}
            />
          </div>
          <span className="w-8 font-mono text-label text-ink-secondary text-right flex-shrink-0">{value}</span>
        </div>
      ))}
    </div>
  )
}

function EmptyMetric({ label }) {
  return <p className="font-body text-body-sm text-ink-secondary py-4 text-center">{label}</p>
}

function VTh({ children }) {
  return (
    <th className="px-4 py-3 text-left font-mono text-label uppercase tracking-widest text-ink-secondary">
      {children}
    </th>
  )
}

function IconEye() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
}
function IconUser() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
}
function IconThumb() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
}
