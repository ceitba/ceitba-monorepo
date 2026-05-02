/**
 * Events CRUD
 *
 * GET    /api/events          (public)
 * GET    /api/events/:id      (public)
 * POST   /api/events          [admin]
 * PATCH  /api/events/:id      [admin]
 * DELETE /api/events/:id      [admin]
 */

function toResponse(row) {
  return {
    id:           row.id,
    title:        row.title,
    date:         row.event_date,    // frontend expects `date`
    time:         row.start_time,    // frontend expects `time`
    endTime:      row.end_time,
    location:     row.location,
    category:     row.category,
    organization: row.organization,
    description:  row.description,
  }
}

export default async function eventRoutes(fastify) {
  const { db } = fastify

  // -- List -------------------------------------------------------------------
  fastify.get('/api/events', async (request) => {
    const { category, organization, from, to, page = '1', limit = '50' } = request.query
    const p = Math.max(1, parseInt(page, 10))
    const l = Math.min(200, Math.max(1, parseInt(limit, 10)))
    const offset = (p - 1) * l

    const conditions = []
    const values = []
    let idx = 1

    if (category)     { conditions.push(`category = $${idx++}`);     values.push(category) }
    if (organization) { conditions.push(`organization = $${idx++}`); values.push(organization) }
    if (from)         { conditions.push(`event_date >= $${idx++}`);  values.push(from) }
    if (to)           { conditions.push(`event_date <= $${idx++}`);  values.push(to) }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const total = parseInt((await db.query(`SELECT COUNT(*) FROM events ${where}`, values)).rows[0].count, 10)

    values.push(l, offset)
    const { rows } = await db.query(
      `SELECT * FROM events ${where} ORDER BY event_date ASC, start_time ASC LIMIT $${idx} OFFSET $${idx + 1}`,
      values
    )
    return { data: rows.map(toResponse), meta: { total, page: p, limit: l } }
  })

  // -- Get one ----------------------------------------------------------------
  fastify.get('/api/events/:id', async (request, reply) => {
    const { rows } = await db.query('SELECT * FROM events WHERE id = $1', [request.params.id])
    if (!rows.length) return reply.code(404).send(notFound(request.params.id))
    return toResponse(rows[0])
  })

  // -- Create -----------------------------------------------------------------
  fastify.post('/api/events', { preHandler: fastify.requireAuth }, async (request, reply) => {
    const b = request.body
    const id = b.id ?? `e${Date.now()}`
    const { rows } = await db.query(
      `INSERT INTO events (id, title, event_date, start_time, end_time, location, category, organization, description, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [id, b.title, b.date ?? b.eventDate, b.time ?? b.startTime,
       b.endTime ?? b.end_time, b.location, b.category,
       b.organization ?? null, b.description ?? null, request.user.sub]
    )
    return reply.code(201).send(toResponse(rows[0]))
  })

  // -- Update -----------------------------------------------------------------
  fastify.patch('/api/events/:id', { preHandler: fastify.requireAuth }, async (request, reply) => {
    const { id } = request.params
    const { rows: existing } = await db.query('SELECT * FROM events WHERE id = $1', [id])
    if (!existing.length) return reply.code(404).send(notFound(id))
    const row = existing[0]
    const b = request.body
    const { rows } = await db.query(
      `UPDATE events SET
        title        = $2,
        event_date   = $3,
        start_time   = $4,
        end_time     = $5,
        location     = $6,
        category     = $7,
        organization = $8,
        description  = $9
       WHERE id = $1 RETURNING *`,
      [id,
       b.title        ?? row.title,
       b.date ?? b.eventDate   ?? row.event_date,
       b.time ?? b.startTime   ?? row.start_time,
       b.endTime      ?? row.end_time,
       b.location     ?? row.location,
       b.category     ?? row.category,
       b.organization ?? row.organization,
       b.description  ?? row.description]
    )
    return toResponse(rows[0])
  })

  // -- Delete -----------------------------------------------------------------
  fastify.delete('/api/events/:id', { preHandler: fastify.requireAuth }, async (request, reply) => {
    const { rowCount } = await db.query('DELETE FROM events WHERE id = $1', [request.params.id])
    if (!rowCount) return reply.code(404).send(notFound(request.params.id))
    return reply.code(204).send()
  })
}

function notFound(id) {
  return { code: 'NOT_FOUND', message: `Event "${id}" not found`, status: 404 }
}
