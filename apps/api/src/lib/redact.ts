// Keeps secrets that travel in URLs out of error messages and logs: the ITBA token is a path segment, presigned
// object-storage / DigitalOcean batch URLs carry their signature in the query string, and Bun's fetch errors
// carry the full request URL in an enumerable `path` property (which pino logs).

const URL_RE = /\bhttps?:\/\/[^\s"'<>]+/gi;

/** A URL without its query string, fragment and userinfo, with each secret (raw or percent-encoded) masked. */
export function redactUrl(url: string, secrets: readonly string[] = []): string {
  let out = url;
  try {
    const u = new URL(url);
    u.search = '';
    u.hash = '';
    u.username = '';
    u.password = '';
    out = u.toString();
  } catch {
    out = url.replace(/[?#].*$/, '');
  }
  return maskSecrets(out, secrets);
}

/** Every http(s) URL inside `text` redacted (redactUrl), and each secret masked anywhere. */
export function redactText(text: string, secrets: readonly string[] = []): string {
  return maskSecrets(text.replace(URL_RE, (u) => redactUrl(u, secrets)), secrets);
}

function maskSecrets(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const s of secrets) {
    if (!s) continue;
    for (const form of new Set([s, encodeURIComponent(s)])) out = out.split(form).join('***');
  }
  return out;
}

/**
 * A copy of `e` safe to keep as a cause or to log: message redacted, the URL-carrying fields (`path`, `url`)
 * redacted, its own cause scrubbed too; `name` and `code` kept.
 */
export function scrubError(e: unknown, secrets: readonly string[] = []): Error {
  if (!(e instanceof Error)) return new Error(redactText(String(e), secrets));
  const copy = new Error(redactText(e.message, secrets), e.cause === undefined ? undefined : { cause: scrubError(e.cause, secrets) });
  copy.name = e.name;
  const src = e as unknown as Record<string, unknown>;
  const dst = copy as unknown as Record<string, unknown>;
  for (const k of Object.keys(src)) {
    const v = src[k];
    if (typeof v === 'string') dst[k] = redactText(v, secrets);
    else if (typeof v === 'number' || typeof v === 'boolean') dst[k] = v;
  }
  return copy;
}

/** For a serialized error object (pino's err serializer output): every string field and cause redacted. */
export function redactSerializedError<T>(obj: T, depth = 0): T {
  if (obj === null || typeof obj !== 'object' || depth > 8) return obj;
  const o = obj as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (typeof v === 'string' && k !== 'stack') o[k] = redactText(v);
    else if (typeof v === 'string') o[k] = v.replace(URL_RE, (u) => redactUrl(u));
    else if (v && typeof v === 'object') redactSerializedError(v, depth + 1);
  }
  return obj;
}
