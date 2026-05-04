import CategoryBadge from '../CategoryBadge'

// Mirrors the GeoFill in ArticleCard — kept local so preview has no router dependency
const GEO_BG = {
  blue:   'bg-primary-500',
  amber:  'bg-accent-400',
  green:  'bg-emerald-600',
  violet: 'bg-violet-600',
}

function CoverMedia({ coverImage, colorScheme, className }) {
  if (coverImage) {
    return (
      <div className={['overflow-hidden flex-shrink-0', className].join(' ')}>
        <img src={coverImage} alt="" aria-hidden="true" className="w-full h-full object-cover" />
      </div>
    )
  }
  const bg = GEO_BG[colorScheme] ?? GEO_BG.blue
  return (
    <div className={['relative overflow-hidden flex-shrink-0', bg, className].join(' ')}>
      <div className="absolute inset-0 opacity-20">
        <div className="absolute top-[-20%] right-[-10%] w-2/3 h-2/3 rounded-full bg-white/30" />
        <div className="absolute bottom-[-15%] left-[-5%] w-1/2 h-1/2 rotate-45 bg-white/20" />
        <div className="absolute top-1/3 left-1/4 w-1/3 h-1/3 rounded-sm rotate-12 bg-black/10" />
      </div>
      <div className="absolute inset-0 bg-gradient-to-br from-black/0 to-black/25" />
    </div>
  )
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('es-AR', {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

// ── Card preview ────────────────────────────────────────────────────────────

function PreviewCard({ article, featured }) {
  if (featured) {
    return (
      <div className="rounded-card border border-border bg-white overflow-hidden shadow-card flex flex-col lg:flex-row">
        <CoverMedia
          coverImage={article.coverImage}
          colorScheme={article.colorScheme}
          className="h-48 lg:h-auto lg:w-1/2"
        />
        <div className="p-6 lg:p-8 flex flex-col justify-between gap-4">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <CategoryBadge category={article.category} />
              <span className="font-mono text-label text-ink-secondary">DESTACADO</span>
            </div>
            <h2 className="font-display text-h2 text-ink-primary font-bold leading-tight">
              {article.title || <span className="text-border italic">Sin título</span>}
            </h2>
            <p className="font-body text-body text-ink-secondary leading-relaxed line-clamp-3">
              {article.excerpt || <span className="text-border italic">Sin copete</span>}
            </p>
          </div>
          <footer className="flex items-center gap-3 pt-2 border-t border-border text-ink-secondary">
            <time className="font-mono text-label">{formatDate(article.date)}</time>
            <span className="text-border">·</span>
            <span className="font-body text-body-sm">{(article.authors ?? []).join(', ') || 'Sin autores'}</span>
            {article.readingTime && (
              <>
                <span className="text-border">·</span>
                <span className="font-mono text-label">{article.readingTime}</span>
              </>
            )}
          </footer>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-card border border-border bg-white overflow-hidden shadow-card flex flex-col">
      <CoverMedia coverImage={article.coverImage} colorScheme={article.colorScheme} className="h-44" />
      <div className="p-5 flex flex-col gap-3">
        <CategoryBadge category={article.category} />
        <h3 className="font-display text-h5 text-ink-primary font-bold leading-snug line-clamp-2">
          {article.title || <span className="text-border italic">Sin título</span>}
        </h3>
        <p className="font-body text-body-sm text-ink-secondary leading-relaxed line-clamp-2">
          {article.excerpt || <span className="text-border italic">Sin copete</span>}
        </p>
        <footer className="flex items-center gap-3 pt-2 border-t border-border">
          <time className="font-mono text-label text-ink-secondary">{formatDate(article.date)}</time>
          <span className="text-border">·</span>
          <span className="font-body text-body-sm text-ink-secondary truncate">
            {(article.authors ?? []).join(', ') || 'Sin autores'}
          </span>
        </footer>
      </div>
    </div>
  )
}

// ── Full article preview ────────────────────────────────────────────────────

function ArticleFullPreview({ article, orgs }) {
  const heroBg = GEO_BG[article.colorScheme] ?? GEO_BG.blue
  const org = orgs.find((o) => o.slug === article.organization)

  return (
    <div className="bg-surface rounded-card border border-border overflow-hidden">
      {/* Hero */}
      {article.coverImage ? (
        <div className="h-56 overflow-hidden">
          <img src={article.coverImage} alt="" className="w-full h-full object-cover" />
        </div>
      ) : (
        <div className={['relative h-44 overflow-hidden', heroBg].join(' ')}>
          <div className="absolute inset-0 opacity-20">
            <div className="absolute top-[-20%] right-[-5%] w-1/2 h-full rounded-full bg-white/30" />
            <div className="absolute bottom-[-30%] left-[-5%] w-2/3 h-2/3 rotate-12 bg-white/20" />
          </div>
          <div className="absolute inset-0 bg-gradient-to-br from-black/0 to-black/30" />
          <div className="absolute bottom-4 left-5">
            <CategoryBadge category={article.category} />
          </div>
        </div>
      )}

      {/* Content */}
      <div className="p-6 lg:p-8">
        {article.coverImage && (
          <div className="mb-3">
            <CategoryBadge category={article.category} />
          </div>
        )}

        {/* Headline */}
        <h1 className="font-display text-h2 font-bold text-ink-primary leading-tight">
          {article.title || <span className="text-border italic">Sin título</span>}
        </h1>

        {/* Meta */}
        <div className="flex flex-wrap items-center gap-3 mt-3 pb-5 border-b border-border">
          <span className="font-body text-body-sm text-ink-secondary">
            por <strong className="text-ink-primary font-semibold">{(article.authors ?? []).join(', ') || '—'}</strong>
          </span>
          <span className="text-border">·</span>
          <time className="font-mono text-label text-ink-secondary">
            {formatDate(article.date)}
          </time>
          {article.readingTime && (
            <>
              <span className="text-border">·</span>
              <span className="font-mono text-label text-ink-secondary">{article.readingTime}</span>
            </>
          )}
          {org && (
            <>
              <span className="text-border">·</span>
              <span className="font-mono text-label text-ink-secondary">{org.name}</span>
            </>
          )}
        </div>

        {/* Body */}
        <div className="mt-5 flex flex-col gap-4">
          {article.body.filter((p) => p.trim()).length > 0 ? (
            article.body.filter((p) => p.trim()).map((para, i) => (
              <p key={i} className="font-body text-body text-ink-primary leading-[1.75]">
                {para}
              </p>
            ))
          ) : article.excerpt ? (
            <p className="font-body text-body text-ink-secondary leading-[1.75] italic">
              {article.excerpt}
            </p>
          ) : (
            <p className="font-body text-body text-border italic">El cuerpo del artículo aparecerá acá.</p>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Public export ────────────────────────────────────────────────────────────

export default function ArticleLivePreview({ article, orgs = [] }) {
  return (
    <div className="flex flex-col gap-10 pb-8">
      {/* Card in standard grid */}
      <section>
        <PreviewLabel>Tarjeta en la lista</PreviewLabel>
        <div className="max-w-sm">
          <PreviewCard article={article} />
        </div>
      </section>

      {/* Card as featured */}
      {article.featured && (
        <section>
          <PreviewLabel>Tarjeta destacada</PreviewLabel>
          <PreviewCard article={article} featured />
        </section>
      )}

      {/* Full article */}
      <section>
        <PreviewLabel>Vista del artículo completo</PreviewLabel>
        <ArticleFullPreview article={article} orgs={orgs} />
      </section>
    </div>
  )
}

function PreviewLabel({ children }) {
  return (
    <p className="font-mono text-label uppercase tracking-widest text-ink-secondary mb-3 flex items-center gap-2">
      <span className="inline-block w-2 h-2 rounded-full bg-accent" />
      {children}
    </p>
  )
}
