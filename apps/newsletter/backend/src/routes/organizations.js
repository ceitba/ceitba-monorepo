/**
 * Organizations — read-only
 *
 * GET  /api/organizations
 * GET  /api/organizations/:slug
 */

function toResponse(row) {
  return {
    slug:        row.slug,
    name:        row.name,
    fullName:    row.full_name,
    description: row.description,
    category:    row.category,
    color:       row.color,
    memberCount: row.member_count,
    foundedYear: row.founded_year,
  }
}

export default async function orgRoutes(fastify) {
  const { db } = fastify

  fastify.get('/api/organizations', async () => {
    const { rows } = await db.query('SELECT * FROM organizations ORDER BY name')
    return { data: rows.map(toResponse) }
  })

  fastify.get('/api/organizations/:slug', async (request, reply) => {
    const { rows } = await db.query('SELECT * FROM organizations WHERE slug = $1', [request.params.slug])
    if (!rows.length) {
      return reply.code(404).send({
        code: 'NOT_FOUND', message: `Organization "${request.params.slug}" not found`, status: 404,
      })
    }
    return toResponse(rows[0])
  })
}
