import pg from 'pg'
import fp from 'fastify-plugin'

async function dbPlugin(fastify) {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
  })

  pool.on('error', (err) => fastify.log.error({ err }, 'pg pool error'))

  fastify.decorate('db', pool)
  fastify.addHook('onClose', () => pool.end())
}

export default fp(dbPlugin, { name: 'db' })
