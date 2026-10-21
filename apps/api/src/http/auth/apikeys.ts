// User API keys (service/auth/ApiKeyService, ApiKeyScope; web/auth/ApiKeyFilter scope rules).

import { createHash } from 'node:crypto';
import type { Db } from '../../db/client';
import { parsePgTimestamp, type Micros } from '../../lib/time';
import { API_KEY_SCOPES, keyHas, type ApiKeyScope, type ValidatedKey } from './principal';
import { findApiKeyByHash, findUserById, markApiKeyUsed } from './repo';

export const API_KEY_PREFIX = 'ceitba_';
export const API_KEY_HEADER = 'X-Api-Key';
export const INSUFFICIENT_SCOPE = 'INSUFFICIENT_SCOPE';

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/** ApiKeyScope.fromKey: case-insensitive, trimmed; null for unknown. */
export function scopeFromKey(key: string): ApiKeyScope | null {
  const k = key.trim().toLowerCase();
  return (API_KEY_SCOPES as readonly string[]).includes(k) ? (k as ApiKeyScope) : null;
}

/** READ is always there and WRITE covers REPORT. */
function implied(set: Set<ApiKeyScope>): Set<ApiKeyScope> {
  set.add('read');
  if (set.has('write')) set.add('report');
  return set;
}

/** ApiKeyScope.normalize: null -> full power; any list (even []) is literal + implied. */
export function normalizeScopes(requested: ApiKeyScope[] | null): Set<ApiKeyScope> {
  if (requested === null) return new Set(API_KEY_SCOPES);
  return implied(new Set(['read', ...requested]));
}

/** ApiKeyScope.parse of the api_keys.scopes CSV (blank -> full power). */
export function parseScopes(csv: string | null | undefined): Set<ApiKeyScope> {
  if (csv == null || csv.trim() === '') return new Set(API_KEY_SCOPES);
  const set = new Set<ApiKeyScope>();
  for (const s of csv.split(',')) {
    if (s.trim() === '') continue;
    const sc = scopeFromKey(s);
    if (!sc) throw new Error(`Unknown API key scope: ${s}`);
    set.add(sc);
  }
  return implied(set);
}

/** Sorted (enum order) lowercase names, as the API returns them. */
export function scopeKeys(scopes: Set<ApiKeyScope>): ApiKeyScope[] {
  return API_KEY_SCOPES.filter((s) => scopes.has(s));
}

export const serializeScopes = (scopes: Set<ApiKeyScope>) => scopeKeys(scopes).join(',');

/** ApiKeyService.validate: by SHA-256 hash, not expired; marks last_used_at. */
export async function validateApiKey(db: Db, rawKey: string, now: Micros): Promise<ValidatedKey | null> {
  if (!rawKey.startsWith(API_KEY_PREFIX)) return null;
  const row = await findApiKeyByHash(db, sha256Hex(rawKey));
  if (!row) return null;
  // ApiKey.isExpired(): expiresAt.isBefore(now) (OffsetDateTime.now()).
  if (parsePgTimestamp(row.expiresAt) < now) return null;
  await markApiKeyUsed(db, row.id, now);
  const user = await findUserById(db, row.userId);
  if (!user) return null;
  return { keyId: row.id, user, scopes: parseScopes(row.scopes) };
}

const READ_STYLE_POSTS = new Set(['/v1/classrooms/conflicts']);
const API_KEYS_PATH = '/v1/auth/api-keys';
const REPORT_PATHS = /^\/v1\/wiki\/(kb\/pages|files)\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\/report$/;

const isSafe = (m: string) => ['GET', 'HEAD', 'OPTIONS'].includes(m.toUpperCase());

/**
 * ApiKeyFilter.scopeDenial: null when the key's scopes allow the request, else
 * the 403 message. `rawPath` is the RAW (undecoded) path inside /api: an
 * encoded or odd path can only fail the exemptions, never pass them.
 */
export function scopeDenial(k: ValidatedKey, method: string, rawPath: string): string | null {
  const m = method.toUpperCase();
  if (m === 'DELETE' && rawPath === `${API_KEYS_PATH}/${k.keyId}`) return null;
  if (!keyHas(k, 'write') && !isSafe(m) && !READ_STYLE_POSTS.has(rawPath)) {
    if (keyHas(k, 'report') && m === 'PUT' && REPORT_PATHS.test(rawPath)) return null;
    return keyHas(k, 'report')
      ? 'This API key can only read and report content (missing scope: write)'
      : 'This API key is read-only (missing scope: write)';
  }
  return null;
}
