/**
 * Votes
 *
 * POST   /api/articles/:id/votes   { type: 'up'|'down' }
 * DELETE /api/articles/:id/votes   (retract current vote for this fingerprint)
 *
 * Fingerprint = SHA-256(ip | user-agent) — no PII stored.
 * One vote per fingerprint per article; casting a different type
 * atomically replaces the old one.
 */

import { createHash } from 'node:crypto'

function fingerprint(request) {
  const ip = request.headers['x-forwarded-for']?.split(',')[0].trim()
         ?? request.socket?.remoteAddress
         ?? 'unknown'
  const ua = request.headers['user-agent'] ?? ''
  return createHash('sha256').update(`${ip}|${ua}`).digest('hex')
}

export default async function voteRoutes(fastify) {
  const { db } = fastify

  // -- Cast or change vote ----------------------------------------------------
  fastify.post('/api/articles/:id/votes', async (request, reply) => {
    const { id } = request.params
    const { type } = request.body

    if (type !== 'up' && type !== 'down') {
      return reply.code(400).send({ code: 'INVALID_TYPE', message: 'type must be "up" or "down"', status: 400 })
    }

    const fp = fingerprint(request)
    const client = await fastify.db.connect()
    try {
      await client.query('BEGIN')

      // Ensure vote aggregate row exists
      await client.query(
        'INSERT INTO article_votes (article_id) VALUES ($1) ON CONFLICT DO NOTHING',
        [id]
      )

      const { rows: existing } = await client.query(
        'SELECT vote_type FROM vote_records WHERE article_id = $1 AND fingerprint = $2',
        [id, fp]
      )
      const prev = existing[0]?.vote_type ?? null

      if (prev === type) {
        // Same vote again — idempotent, no change
      } else {
        if (prev) {
          // Undo previous
          await client.query(
            `UPDATE article_votes SET ${prev}_count = GREATEST(0, ${prev}_count - 1), updated_at = now() WHERE article_id = $1`,
            [id]
          )
        }
        // Apply new vote
        await client.query(
          `UPDATE article_votes SET ${type}_count = ${type}_count + 1, updated_at = now() WHERE article_id = $1`,
          [id]
        )
        await client.query(
          `INSERT INTO vote_records (article_id, fingerprint, vote_type)
           VALUES ($1, $2, $3)
           ON CONFLICT (article_id, fingerprint) DO UPDATE SET vote_type = $3, created_at = now()`,
          [id, fp, type]
        )
      }

      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }

    const { rows } = await db.query(
      'SELECT up_count, down_count FROM article_votes WHERE article_id = $1',
      [id]
    )
    const counts = rows[0] ?? { up_count: 0, down_count: 0 }
    return { up: counts.up_count, down: counts.down_count }
  })

  // -- Retract vote -----------------------------------------------------------
  fastify.delete('/api/articles/:id/votes', async (request, reply) => {
    const { id } = request.params
    const fp = fingerprint(request)
    const client = await fastify.db.connect()
    try {
      await client.query('BEGIN')
      const { rows } = await client.query(
        'DELETE FROM vote_records WHERE article_id = $1 AND fingerprint = $2 RETURNING vote_type',
        [id, fp]
      )
      if (rows.length) {
        const type = rows[0].vote_type
        await client.query(
          `UPDATE article_votes SET ${type}_count = GREATEST(0, ${type}_count - 1), updated_at = now() WHERE article_id = $1`,
          [id]
        )
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
    return reply.code(204).send()
  })
}
