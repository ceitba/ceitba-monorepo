/**
 * Google OAuth 2.0 authorization-code flow.
 *
 * GET  /auth/google          → redirect to Google consent screen
 * GET  /auth/google/callback → exchange code, upsert user, set httpOnly JWT cookie
 * POST /auth/logout          → clear cookie
 * GET  /auth/me              → return current user from JWT
 */

import { createHash, randomBytes } from 'node:crypto'

const GOOGLE_AUTH_URL   = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL  = 'https://oauth2.googleapis.com/token'
const GOOGLE_USERINFO   = 'https://www.googleapis.com/oauth2/v3/userinfo'

// State tokens: nonce map to prevent CSRF (in-process, sufficient for a single instance)
const stateMap = new Map()
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000  // 10 min TTL
  for (const [k, v] of stateMap) if (v < cutoff) stateMap.delete(k)
}, 60_000)

export default async function authRoutes(fastify) {
  const { db } = fastify

  // -- Initiate flow ----------------------------------------------------------
  fastify.get('/auth/google', async (request, reply) => {
    const state = randomBytes(16).toString('hex')
    stateMap.set(state, Date.now())

    const params = new URLSearchParams({
      response_type: 'code',
      client_id:     process.env.GOOGLE_CLIENT_ID,
      redirect_uri:  process.env.GOOGLE_CALLBACK_URL,
      scope:         'openid email profile',
      state,
      access_type:   'online',
    })
    return reply.redirect(`${GOOGLE_AUTH_URL}?${params}`)
  })

  // -- Callback ---------------------------------------------------------------
  fastify.get('/auth/google/callback', async (request, reply) => {
    const { code, state, error } = request.query
    const frontendAdmin = process.env.FRONTEND_ADMIN_URL ?? '/admin'

    if (error || !code) {
      return reply.redirect(`${frontendAdmin}/login?error=oauth_denied`)
    }
    if (!state || !stateMap.has(state)) {
      return reply.redirect(`${frontendAdmin}/login?error=invalid_state`)
    }
    stateMap.delete(state)

    // Exchange code for tokens
    let tokenData
    try {
      const res = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type:    'authorization_code',
          code,
          redirect_uri:  process.env.GOOGLE_CALLBACK_URL,
          client_id:     process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
        }),
      })
      tokenData = await res.json()
    } catch (err) {
      fastify.log.error(err, 'google token exchange failed')
      return reply.redirect(`${frontendAdmin}/login?error=auth_failed`)
    }

    if (tokenData.error) {
      fastify.log.warn(tokenData, 'google returned error')
      return reply.redirect(`${frontendAdmin}/login?error=auth_failed`)
    }

    // Fetch user info
    let profile
    try {
      const res = await fetch(GOOGLE_USERINFO, {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      })
      profile = await res.json()
    } catch (err) {
      fastify.log.error(err, 'google userinfo failed')
      return reply.redirect(`${frontendAdmin}/login?error=auth_failed`)
    }

    // Upsert user
    const { rows } = await db.query(
      `INSERT INTO users (google_sub, email, name, avatar_url)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (google_sub) DO UPDATE
         SET email = EXCLUDED.email, name = EXCLUDED.name, avatar_url = EXCLUDED.avatar_url
       RETURNING id, email, name, role, avatar_url`,
      [profile.sub, profile.email, profile.name, profile.picture ?? null]
    )
    const user = rows[0]

    const token = await reply.jwtSign(
      { sub: user.id, role: user.role },
      { expiresIn: '8h' }
    )
    reply.setCookie('session', token, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path:     '/',
      maxAge:   8 * 60 * 60,
    })

    return reply.redirect(frontendAdmin)
  })

  // -- Logout -----------------------------------------------------------------
  fastify.post('/auth/logout', async (request, reply) => {
    reply.clearCookie('session', { path: '/' })
    return reply.code(204).send()
  })

  // -- Current user -----------------------------------------------------------
  fastify.get('/auth/me', { preHandler: fastify.requireAuth }, async (request) => {
    const { rows } = await db.query(
      'SELECT id, email, name, role, avatar_url FROM users WHERE id = $1',
      [request.user.sub]
    )
    if (!rows.length) throw { statusCode: 404, message: 'User not found' }
    const u = rows[0]
    return { id: u.id, name: u.name, email: u.email, role: u.role, avatarUrl: u.avatar_url }
  })
}
