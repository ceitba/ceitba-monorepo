/**
 * Media — presigned R2/S3 upload URLs
 *
 * POST /api/media/sign-upload  [admin]
 *   body: { filename, contentType, sizeBytes }
 *   → { uploadUrl, publicUrl, key }
 */

import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl }     from '@aws-sdk/s3-request-presigner'
import { randomBytes }      from 'node:crypto'
import { extname }          from 'node:path'

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_BYTES     = 5 * 1024 * 1024   // 5 MB

export default async function mediaRoutes(fastify) {
  fastify.post('/api/media/sign-upload', { preHandler: fastify.requireAuth }, async (request, reply) => {
    const { filename, contentType, sizeBytes } = request.body ?? {}

    if (!filename || !contentType || !sizeBytes) {
      return reply.code(400).send({ code: 'MISSING_FIELDS', message: 'filename, contentType, and sizeBytes are required', status: 400 })
    }
    if (!ALLOWED_TYPES.has(contentType)) {
      return reply.code(400).send({ code: 'INVALID_TYPE', message: 'contentType must be image/jpeg, image/png, or image/webp', status: 400 })
    }
    if (sizeBytes > MAX_BYTES) {
      return reply.code(400).send({ code: 'TOO_LARGE', message: 'File exceeds 5 MB limit', status: 400 })
    }

    const ext = extname(filename) || '.jpg'
    const uuid = randomBytes(16).toString('hex')
    const key  = `articles/${uuid}${ext}`

    const command = new PutObjectCommand({
      Bucket:        process.env.R2_BUCKET,
      Key:           key,
      ContentType:   contentType,
      ContentLength: sizeBytes,
    })

    const uploadUrl  = await getSignedUrl(fastify.s3, command, { expiresIn: 300 })
    const publicUrl  = `${process.env.R2_PUBLIC_URL}/${key}`

    return { uploadUrl, publicUrl, key }
  })
}
