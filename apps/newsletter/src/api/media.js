import { apiSend } from './client'

// What POST /media/sign-upload accepts (MediaUploadService): STAFF only,
// jpeg/png/webp up to 5 MB.
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

// Browsers refuse to set these on fetch; they are computed from the body.
const FORBIDDEN_HEADERS = new Set(['content-length', 'host'])

export async function uploadViaSignedUrl(file) {
  const signed = await apiSend('POST', '/media/sign-upload', {
    filename:    file.name,
    contentType: file.type,
    sizeBytes:   file.size,
  })
  const headers = Object.fromEntries(
    Object.entries(signed.headers ?? { 'Content-Type': file.type })
      .filter(([k]) => !FORBIDDEN_HEADERS.has(k.toLowerCase())),
  )
  const putRes = await fetch(signed.uploadUrl, {
    method:  signed.method ?? 'PUT',
    headers,
    body:    file,
  })
  if (!putRes.ok) throw new Error('PUT to storage failed')
  return signed.publicUrl
}
