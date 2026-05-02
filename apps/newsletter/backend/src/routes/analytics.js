/**
 * Analytics
 *
 * POST /api/analytics/events   [no auth, rate limited]  batch ingestion
 * GET  /api/analytics/summary  [admin]                  aggregated stats
 */

import { createHash } from 'node:crypto'

const VALID_TYPES = new Set(['article_view', 'page_view', 'category_filter'])
const MAX_BATCH  = 50

function ipHash(request) {
  const ip = request.headers['x-forwarded-for']?.split(',')[0].trim()
         ?? request.socket?.remoteAddress
         ?? 'unknown'
  return createHash('sha256').update(ip).digest('hex')
}

export default async function analyticsRoutes(fastify) {
  const { db } = fastify

  // -- Ingest -----------------------------------------------------------------
  fastify.post('/api/analytics/events', async (request, reply) => {
    const { events } = request.body ?? {}
    if (!Array.isArray(events) || events.length === 0) {
      return reply.code(400).send({ code: 'INVALID_BODY', message: 'events must be a non-empty array', status: 400 })
    }

    const batch = events.slice(0, MAX_BATCH)
    const hash  = ipHash(request)

    // Build a multi-row INSERT
    const placeholders = []
    const values       = []
    let idx = 1

    for (const e of batch) {
      if (!VALID_TYPES.has(e.type)) continue
      const ts = e.timestamp ? new Date(e.timestamp) : new Date()
      placeholders.push(`($${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++})`)
      values.push(e.type, e.sessionId ?? null, ts, e.articleId ?? null, e.category ?? null, e.path ?? null, hash)
    }

    if (placeholders.length > 0) {
      await db.query(
        `INSERT INTO analytics_events (type, session_id, ts, article_id, category, path, ip_hash)
         VALUES ${placeholders.join(',')}`,
        values
      )
    }

    return reply.code(202).send()
  })

  // -- Summary ----------------------------------------------------------------
  fastify.get('/api/analytics/summary', { preHandler: fastify.requireAuth }, async (request) => {
    const days = Math.min(90, Math.max(1, parseInt(request.query.days ?? '30', 10)))
    const since = `now() - interval '${days} days'`

    const [totalQ, uniqueQ, topQ, catQ, dailyQ, votesQ] = await Promise.all([
      db.query(
        `SELECT COUNT(*) AS n FROM analytics_events WHERE type = 'article_view' AND ts >= ${since}`
      ),
      db.query(
        `SELECT COUNT(DISTINCT session_id) AS n FROM analytics_events WHERE ts >= ${since}`
      ),
      db.query(
        `SELECT ae.article_id, a.title, COUNT(*) AS views
         FROM analytics_events ae
         LEFT JOIN articles a ON a.id = ae.article_id
         WHERE ae.type = 'article_view' AND ae.ts >= ${since} AND ae.article_id IS NOT NULL
         GROUP BY ae.article_id, a.title
         ORDER BY views DESC
         LIMIT 10`
      ),
      db.query(
        `SELECT category, COUNT(*) AS views
         FROM analytics_events
         WHERE type IN ('article_view','category_filter') AND ts >= ${since} AND category IS NOT NULL
         GROUP BY category
         ORDER BY views DESC`
      ),
      db.query(
        `SELECT date_trunc('day', ts)::date AS date, COUNT(*) AS views
         FROM analytics_events
         WHERE type = 'article_view' AND ts >= ${since}
         GROUP BY 1
         ORDER BY 1`
      ),
      db.query(
        `SELECT av.article_id, a.title, av.up_count AS up, av.down_count AS down
         FROM article_votes av
         LEFT JOIN articles a ON a.id = av.article_id
         ORDER BY (av.up_count + av.down_count) DESC
         LIMIT 20`
      ),
    ])

    return {
      totalArticleViews: parseInt(totalQ.rows[0].n, 10),
      uniqueVisitors:    parseInt(uniqueQ.rows[0].n, 10),
      topArticles:       topQ.rows.map(r => ({ articleId: r.article_id, title: r.title, views: parseInt(r.views, 10) })),
      categoryViews:     catQ.rows.map(r => ({ category: r.category, views: parseInt(r.views, 10) })),
      dailyViews:        dailyQ.rows.map(r => ({ date: r.date, views: parseInt(r.views, 10) })),
      voteBreakdown:     votesQ.rows.map(r => ({ articleId: r.article_id, title: r.title, up: r.up, down: r.down })),
    }
  })
}
