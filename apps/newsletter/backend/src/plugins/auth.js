import fp from 'fastify-plugin'
import jwt from '@fastify/jwt'
import cookie from '@fastify/cookie'

async function authPlugin(fastify) {
  await fastify.register(cookie)
  await fastify.register(jwt, {
    secret: process.env.JWT_SECRET,
    cookie: { cookieName: 'session', signed: false },
  })

  // Decorator used as a preHandler on protected routes
  fastify.decorate('requireAuth', async function (request, reply) {
    try {
      await request.jwtVerify()
    } catch {
      reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 })
    }
  })
}

export default fp(authPlugin, { name: 'auth' })
