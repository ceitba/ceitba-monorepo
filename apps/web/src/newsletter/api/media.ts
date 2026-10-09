import { apiSend } from '@/api/client'
import type { SignUploadResponse } from '../types'

// What the image sign-upload endpoints accept (MediaUploadService): jpeg,
// png or webp up to 5 MB. POST /media/sign-upload is STAFF only; members of
// an organization sign under /organizations/{slug}/media/sign-upload.
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

// Browsers refuse to set these on fetch; they are computed from the body.
const FORBIDDEN_HEADERS = new Set(['content-length', 'host'])

export const STAFF_SIGN_PATH = '/media/sign-upload'

export function orgSignPath(slug: string): string {
  return `/organizations/${encodeURIComponent(slug)}/media/sign-upload`
}

// Resolves to the uploaded object's public URL.
export async function uploadViaSignedUrl(file: File, signPath: string = STAFF_SIGN_PATH): Promise<string> {
  const signed = await apiSend<SignUploadResponse>('POST', signPath, {
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
