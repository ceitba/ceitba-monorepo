// Request bodies are read with a size cap: 1 MiB by default, more only on the routes that take bulk payloads
// (RouteSpec.maxBodyBytes). A larger Content-Length is refused before reading anything; a chunked body is read
// until it passes the cap. Either way: 413 PayloadTooLarge (the body Spring answered for
// MaxUploadSizeExceededException). The Spring app had no cap on JSON bodies (Tomcat's maxPostSize only covers
// form posts), so this is a deliberate hardening (contract/COMPATIBILITY.md "Request body size").

import { PayloadTooLargeError } from './errors';

export const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
/** Bulk imports (SYNC Firestore export, STAFF wiki import): the largest per-route cap. */
export const BULK_MAX_BODY_BYTES = 64 * 1024 * 1024;
/**
 * Bun.serve's maxRequestBodySize: a little above the largest route cap, so that every body over a route's cap
 * (declared, or chunked and read ahead by Bun) reaches readBodyText and gets the JSON 413. Bun answers a body
 * over this ceiling itself, before the app, with an empty 413 (contract/COMPATIBILITY.md "Request body size").
 */
export const SERVER_MAX_BODY_BYTES = BULK_MAX_BODY_BYTES + 4 * 1024 * 1024;
/** Authored content that may inline images (articles, events, announcements, digests). */
export const CONTENT_MAX_BODY_BYTES = 10 * 1024 * 1024;

export async function readBodyText(req: Request, maxBytes: number = DEFAULT_MAX_BODY_BYTES): Promise<string> {
  const declared = req.headers.get('content-length');
  if (declared !== null && Number(declared) > maxBytes) throw new PayloadTooLargeError(maxBytes);
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new PayloadTooLargeError(maxBytes);
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
