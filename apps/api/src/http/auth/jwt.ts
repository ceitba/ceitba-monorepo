// Our HS256 JWTs: issuing (service/auth/JwtIssuerService) and verification
// (SecurityConfig.jwtDecoder: NimbusJwtDecoder + JwtValidators.createDefault()
// + IssuerAudienceValidator), with the same error descriptions Spring puts in
// `WWW-Authenticate: Bearer error="invalid_token", error_description="..."`.

import { compactVerify, decodeProtectedHeader, SignJWT, type JWTPayload } from 'jose';
import type { AuthConfig } from '../../config/sections/auth';
import { instantOfEpochSecond, type Micros } from '../../lib/time';

const DECODING = 'An error occurred while attempting to decode the Jwt: ';
/** JwtTimestampValidator's default clock skew. */
export const CLOCK_SKEW_SECONDS = 60;

export class JwtValidationFailure extends Error {
  /** error_description for WWW-Authenticate. */
  constructor(readonly description: string) {
    super(description);
  }
}

export interface IssuedToken {
  token: string;
  /** Second precision, like the exp claim. */
  expiresAtMicros: Micros;
}

/**
 * JwtIssuerService.issue. Nimbus keeps the claims in a HashMap, so the payload
 * JSON order is the HashMap iteration order of these keys, verified against
 * tokens the jar issues: aud, sub, iss, name, exp, iat, jti, email. A null
 * name is omitted. Header: {"alg":"HS256"}.
 */
export async function issueJwt(auth: AuthConfig, user: { id: string; email: string; name: string | null }, ttlMs: number, nowMicros: Micros): Promise<IssuedToken> {
  const iat = Math.floor(nowMicros / 1_000_000);
  // Instant.plus then getEpochSecond: exp = floor((now + ttl) seconds).
  const exp = Math.floor((nowMicros + ttlMs * 1000) / 1_000_000);
  const payload: Record<string, unknown> = { aud: auth.jwt.audience, sub: user.id, iss: auth.jwt.issuer };
  if (user.name !== null && user.name !== undefined) payload.name = user.name;
  payload.exp = exp;
  payload.iat = iat;
  payload.jti = crypto.randomUUID();
  payload.email = user.email;
  const token = await new SignJWT(payload as JWTPayload).setProtectedHeader({ alg: 'HS256' }).sign(auth.jwt.secretBytes);
  return { token, expiresAtMicros: exp * 1_000_000 };
}

/** Web session token lifetime (auth.jwt.ttl-days, 7 when <= 0). */
export function webTtlMs(auth: AuthConfig): number {
  return (auth.jwt.ttlDays > 0 ? auth.jwt.ttlDays : 7) * 86_400_000;
}

const toSeconds = (v: unknown): number | null => {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number') return Math.floor(v);
  if (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v)) return Math.floor(Number(v));
  return null;
};

function claimAsString(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(String).join(', ');
  return String(v);
}

/** Verifies a token like the Java JwtDecoder bean; throws JwtValidationFailure with Spring's description. */
export async function verifyJwt(auth: AuthConfig, token: string, nowMicros: Micros): Promise<JWTPayload> {
  // JWTParser.parse: anything that is not header.payload.signature JSON is "Malformed token".
  const parts = token.split('.');
  let header: { alg?: string };
  let payload: JWTPayload;
  try {
    if (parts.length !== 3 && parts.length !== 5) throw new Error('parts');
    header = decodeProtectedHeader(token) as { alg?: string };
    if (parts.length === 5) throw new JwtValidationFailure(`${DECODING}Encrypted JWT rejected: No JWE key selector is configured`);
    payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as JWTPayload;
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) throw new Error('claims');
  } catch (e) {
    if (e instanceof JwtValidationFailure) throw e;
    throw new JwtValidationFailure(`${DECODING}Malformed token`);
  }
  if (!header.alg || header.alg === 'none') {
    throw new JwtValidationFailure(`${DECODING}Unsecured (plain) JWTs are rejected, extend class to handle`);
  }
  if (header.alg !== 'HS256') {
    throw new JwtValidationFailure(`${DECODING}Signed JWT rejected: Another algorithm expected, or no matching key(s) found`);
  }
  try {
    await compactVerify(token, auth.jwt.secretBytes, { algorithms: ['HS256'] });
  } catch {
    throw new JwtValidationFailure(`${DECODING}Signed JWT rejected: Invalid signature`);
  }
  // Building Spring's Jwt asserts exp > iat (AbstractOAuth2Token), before any validator runs.
  const exp = toSeconds(payload.exp);
  const iat = toSeconds(payload.iat);
  if (exp !== null && iat !== null && !(exp > iat)) {
    throw new JwtValidationFailure(`${DECODING}expiresAt must be after issuedAt`);
  }
  // JwtTimestampValidator (60 s skew), then IssuerAudienceValidator.
  const nowSecs = nowMicros / 1_000_000;
  if (exp !== null && nowSecs - CLOCK_SKEW_SECONDS > exp) {
    throw new JwtValidationFailure(`${DECODING}Jwt expired at ${instantOfEpochSecond(exp)}`);
  }
  const nbf = toSeconds(payload.nbf);
  if (nbf !== null && nowSecs + CLOCK_SKEW_SECONDS < nbf) {
    throw new JwtValidationFailure(`${DECODING}Jwt used before ${instantOfEpochSecond(nbf)}`);
  }
  const enforce = auth.jwt.enforceIssuerAudience;
  const hasIss = payload.iss !== undefined && payload.iss !== null;
  if ((enforce || hasIss) && auth.jwt.issuer !== claimAsString(payload.iss)) {
    throw new JwtValidationFailure(`${DECODING}The iss claim is not valid`);
  }
  const hasAud = payload.aud !== undefined && payload.aud !== null;
  const aud = payload.aud === undefined || payload.aud === null ? null : Array.isArray(payload.aud) ? payload.aud.map(String) : [String(payload.aud)];
  if ((enforce || hasAud) && (aud === null || !aud.includes(auth.jwt.audience))) {
    throw new JwtValidationFailure(`${DECODING}The aud claim is not valid`);
  }
  return payload;
}

/** jwt.getClaimAsString(name). */
export function stringClaim(payload: JWTPayload, name: string): string | null {
  return claimAsString((payload as Record<string, unknown>)[name]);
}
