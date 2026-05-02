import 'dotenv/config'
import Fastify           from 'fastify'
import cors              from '@fastify/cors'
import rateLimit         from '@fastify/rate-limit'
import { S3Client }      from '@aws-sdk/client-s3'

import dbPlugin          from './plugins/db.js'
import authPlugin        from './plugins/auth.js'

import authRoutes        from './routes/auth.js'
import articleRoutes     from './routes/articles.js'
import eventRoutes       from './routes/events.js'
import orgRoutes         from './routes/organizations.js'
import voteRoutes        from './routes/votes.js'
import analyticsRoutes   from './routes/analytics.js'
import mediaRoutes       from './routes/media.js'

const fastify = Fastify({ logger: true })

// -- CORS ---------------------------------------------------------------------
await fastify.register(cors, {
  origin: process.env.CORS_ORIGINS?.split(',') ?? true,
  credentials: true,
})

// -- Rate limiting ------------------------------------------------------------
await fastify.register(rateLimit, { max: 300, timeWindow: '1 minute' })

// -- Database + auth plugins --------------------------------------------------
await fastify.register(dbPlugin)
await fastify.register(authPlugin)

// -- S3/R2 client -------------------------------------------------------------
if (process.env.R2_ACCOUNT_ID) {
  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId:     process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_KEY,
    },
  })
  fastify.decorate('s3', s3)
}

// -- Routes -------------------------------------------------------------------
await fastify.register(authRoutes)
await fastify.register(articleRoutes)
await fastify.register(eventRoutes)
await fastify.register(orgRoutes)
await fastify.register(voteRoutes)
await fastify.register(analyticsRoutes)
await fastify.register(mediaRoutes)

// -- Start --------------------------------------------------------------------
try {
  const port = parseInt(process.env.PORT ?? '3001', 10)
  await fastify.listen({ port, host: '0.0.0.0' })
} catch (err) {
  fastify.log.error(err)
  process.exit(1)
}
