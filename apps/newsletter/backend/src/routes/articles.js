/**
 * Articles CRUD
 *
 * GET    /api/articles          (public: published only; admin: can pass status=draft|all)
 * GET    /api/articles/:id      (public: 404 on draft; admin: sees draft)
 * POST   /api/articles          [admin]
 * PATCH  /api/articles/:id      [admin]
 * DELETE /api/articles/:id      [admin]
 */

function toResponse(row) {
  return {
    id:           row.id,
    title:        row.title,
    excerpt:      row.excerpt,
    body:         row.body,
    category:     row.category,
    organization: row.organization,
    author:       row.author,
    date:         row.published_at,        // frontend expects `date`
    readingTime:  row.reading_time,
    featured:     row.featured,
    colorScheme:  row.color_scheme,
    coverImage:   row.cover_image,
    status:       row.status,
    createdAt:    row.created_at,
    updatedAt:    row.updated_at,
  }
}

export default async function articleRoutes(fastify) {
  const { db } = fastify

  // -- List -------------------------------------------------------------------
  fastify.get('/api/articles', async (request, reply) => {
    const isAdmin = await isAuthenticatedAdmin(request)
    const { category, organization, page = '1', limit = '20' } = request.query
    let { status } = request.query

    // Public callers can only see published
    if (!isAdmin) status = 'published'
    else if (!status) status = 'published'

    const p = Math.max(1, parseInt(page, 10))
    const l = Math.min(100, Math.max(1, parseInt(limit, 10)))
    const offset = (p - 1) * l

    const conditions = []
    const values = []
    let idx = 1

    if (status !== 'all') {
      conditions.push(`status = $${idx++}`)
      values.push(status)
    }
    if (category) {
      conditions.push(`category = $${idx++}`)
      values.push(category)
    }
    if (organization) {
      conditions.push(`organization = $${idx++}`)
      values.push(organization)
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const countQ = await db.query(`SELECT COUNT(*) FROM articles ${where}`, values)
    const total  = parseInt(countQ.rows[0].count, 10)

    values.push(l, offset)
    const dataQ = await db.query(
      `SELECT * FROM articles ${where} ORDER BY published_at DESC NULLS LAST, created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      values
    )

    return reply.send({ data: dataQ.rows.map(toResponse), meta: { total, page: p, limit: l } })
  })

  // -- Get one ----------------------------------------------------------------
  fastify.get('/api/articles/:id', async (request, reply) => {
    const isAdmin = await isAuthenticatedAdmin(request)
    const { rows } = await db.query('SELECT * FROM articles WHERE id = $1', [request.params.id])
    if (!rows.length) return reply.code(404).send(notFound(request.params.id))
    const article = rows[0]
    if (!isAdmin && article.status !== 'published') return reply.code(404).send(notFound(request.params.id))
    return toResponse(article)
  })

  // -- Create -----------------------------------------------------------------
  fastify.post('/api/articles', { preHandler: fastify.requireAuth }, async (request, reply) => {
    const b = request.body
    const id = b.id ?? `a${Date.now()}`
    const { rows } = await db.query(
      `INSERT INTO articles (id, title, excerpt, body, category, organization, author,
         published_at, reading_time, featured, color_scheme, cover_image, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [id, b.title, b.excerpt, JSON.stringify(b.body ?? []), b.category, b.organization ?? null,
       b.author, b.date ?? b.publishedAt ?? null, b.readingTime ?? null,
       b.featured ?? false, b.colorScheme ?? 'blue', b.coverImage ?? null,
       b.status ?? 'published', request.user.sub]
    )
    // Initialise vote row
    await db.query('INSERT INTO article_votes (article_id) VALUES ($1) ON CONFLICT DO NOTHING', [id])
    return reply.code(201).send(toResponse(rows[0]))
  })

  // -- Update -----------------------------------------------------------------
  fastify.patch('/api/articles/:id', { preHandler: fastify.requireAuth }, async (request, reply) => {
    const { id } = request.params
    const { rows: existing } = await db.query('SELECT * FROM articles WHERE id = $1', [id])
    if (!existing.length) return reply.code(404).send(notFound(id))

    const b = request.body
    const row = existing[0]
    const { rows } = await db.query(
      `UPDATE articles SET
        title        = $2,
        excerpt      = $3,
        body         = $4,
        category     = $5,
        organization = $6,
        author       = $7,
        published_at = $8,
        reading_time = $9,
        featured     = $10,
        color_scheme = $11,
        cover_image  = $12,
        status       = $13,
        updated_at   = now()
       WHERE id = $1 RETURNING *`,
      [id,
       b.title        ?? row.title,
       b.excerpt      ?? row.excerpt,
       JSON.stringify(b.body ?? row.body),
       b.category     ?? row.category,
       b.organization ?? row.organization,
       b.author       ?? row.author,
       b.date ?? b.publishedAt ?? row.published_at,
       b.readingTime  ?? row.reading_time,
       b.featured     ?? row.featured,
       b.colorScheme  ?? row.color_scheme,
       b.coverImage   ?? row.cover_image,
       b.status       ?? row.status]
    )
    return toResponse(rows[0])
  })

  // -- Delete -----------------------------------------------------------------
  fastify.delete('/api/articles/:id', { preHandler: fastify.requireAuth }, async (request, reply) => {
    const { rowCount } = await db.query('DELETE FROM articles WHERE id = $1', [request.params.id])
    if (!rowCount) return reply.code(404).send(notFound(request.params.id))
    return reply.code(204).send()
  })
}

function notFound(id) {
  return { code: 'NOT_FOUND', message: `Article "${id}" not found`, status: 404 }
}

// Silently check auth without throwing — used for public endpoints that show
// more data when the requester is an admin.
async function isAuthenticatedAdmin(request) {
  try {
    await request.jwtVerify()
    return true
  } catch {
    return false
  }
}
