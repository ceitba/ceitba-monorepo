// AuthController.isSafeRedirect / withError, with java.net.URI's strictness.

export const SAFE_REDIRECT_ORIGINS = [
  'https://ceitba.org.ar',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5173',
  'http://localhost:5175',
];

// Characters java.net.URI accepts (anything else is a URISyntaxException).
const URI_CHARS = /^[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]*$/;
const ABSOLUTE = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/;

/** Exact origin match (scheme + host + port); userinfo, opaque or relative URIs are refused. */
export function isSafeRedirect(uri: string | null | undefined): boolean {
  if (uri == null || uri.trim() === '') return false;
  if (!URI_CHARS.test(uri) || /%(?![0-9A-Fa-f]{2})/.test(uri)) return false;
  const m = ABSOLUTE.exec(uri);
  if (!m) return false;
  const authority = m[2]!;
  if (authority.includes('@')) return false;
  const hp = /^(\[[^\]]+\]|[^:]*)(?::(\d*))?$/.exec(authority);
  if (!hp || hp[1] === '') return false;
  if (!/^(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+)$/.test(hp[1]!)) return false;
  const scheme = m[1]!.toLowerCase();
  let port = hp[2] ? Number(hp[2]) : -1;
  if ((port === 443 && scheme === 'https') || (port === 80 && scheme === 'http')) port = -1;
  const origin = `${scheme}://${hp[1]!.toLowerCase()}${port === -1 ? '' : `:${port}`}`;
  return SAFE_REDIRECT_ORIGINS.includes(origin);
}

/** UriComponentsBuilder.fromUriString(target).replaceQueryParam("error", reason).build().toUriString(). */
export function withError(target: string, reason: string): string {
  const hashIdx = target.indexOf('#');
  const fragment = hashIdx >= 0 ? target.slice(hashIdx) : '';
  const beforeHash = hashIdx >= 0 ? target.slice(0, hashIdx) : target;
  const qIdx = beforeHash.indexOf('?');
  const base = qIdx >= 0 ? beforeHash.slice(0, qIdx) : beforeHash;
  const query = qIdx >= 0 ? beforeHash.slice(qIdx + 1) : '';
  const kept = query === '' ? [] : query.split('&').filter((p) => p !== '' && p.split('=')[0] !== 'error');
  kept.push(`error=${reason}`);
  return `${base}?${kept.join('&')}${fragment}`;
}
