// web/auth/AuthController + TokenAuthController + DevLoginController.

import { apiKeyCredential, currentUser } from '../../http/auth/context';
import { clearSessionCookies, formatCookie, readCookie, sessionCookie } from '../../http/auth/cookies';
import { LoginRejectedError, ValidationError } from '../../http/errors';
import { defineRoutes, emptyStatus, found, json, noContent } from '../../http/router';
import { bindBody, param } from '../../http/validation';
import { CreateApiKeyRequest, DevLoginRequest, GoogleMobileLoginRequest, LogoutRequest, RefreshRequest, ReviewLoginRequest, type TokenResponse } from './dto';
import { isSafeRedirect, withError } from './redirects';
import { AuthService, OAUTH_STATE_TTL_SECONDS } from './service';

export const STATE_COOKIE = 'ceitba_oauth_state';

export default defineRoutes((r, deps) => {
  const auth = deps.config.auth;
  const svc = new AuthService(deps);
  const log = deps.log.child({ component: 'AuthController' });

  // SameSite=Lax: Google's redirect back to /callback is a cross-site top-level GET.
  const stateCookie = (value: string, maxAge: number) => formatCookie({
    name: STATE_COOKIE, value, httpOnly: true, secure: auth.cookie.secure, path: auth.cookie.path, sameSite: 'Lax', maxAgeSeconds: maxAge,
  });
  const noStore = (body: TokenResponse) => json(body, 200, { 'Cache-Control': 'no-store' });

  r.get('/v1/auth/google', { query: { redirect_uri: param.string({ required: false }) }, tags: ['Auth'] }, ({ query }) => {
    const target = isSafeRedirect(query.redirect_uri) ? query.redirect_uri! : auth.frontendUrl;
    const issued = svc.issueOAuthState(target);
    return found(deps.google.oauth.buildAuthorizationUri(issued.state), { 'Set-Cookie': stateCookie(issued.nonce, OAUTH_STATE_TTL_SECONDS) });
  });

  r.get('/v1/auth/callback', {
    query: { code: param.string({ required: false }), state: param.string({ required: false }), error: param.string({ required: false }) },
    tags: ['Auth'],
  }, async ({ c, query }) => {
    const nonce = readCookie(c.req.header('cookie'), STATE_COOKIE);
    const verified = svc.verifyOAuthState(query.state, nonce);
    if (verified === null || !(verified === auth.frontendUrl || isSafeRedirect(verified))) {
      return found(withError(auth.frontendUrl, 'invalid_state'));
    }
    if (query.error !== null || query.code === null || query.code.trim() === '') {
      // Only codes the SPAs know; Google's value is never echoed back.
      const reason = query.error === 'access_denied' ? 'access_denied' : 'auth_failed';
      return found(withError(verified, reason), { 'Set-Cookie': stateCookie('', 0) });
    }
    try {
      const claims = await deps.google.oauth.exchangeCode(query.code);
      const user = await svc.admit(claims);
      const token = await svc.issueWebToken(user);
      const h = new Headers();
      h.append('Set-Cookie', sessionCookie(auth, token));
      h.append('Set-Cookie', stateCookie('', 0));
      return found(verified, h);
    } catch (e) {
      if (e instanceof LoginRejectedError) return found(withError(verified, e.code));
      log.warn(`Google OAuth callback failed: ${(e as Error).name}: ${(e as Error).message}`);
      return found(withError(verified, 'auth_failed'));
    }
  });

  // 204 whatever the Content-Type: the body is read raw and parsed only when it is JSON.
  r.post('/v1/auth/logout', { rawBody: true, tags: ['Auth'] }, async ({ c, rawBody }) => {
    const ct = c.req.header('content-type');
    let refreshToken: string | null = null;
    if (rawBody !== null && rawBody.trim() !== '' && ct && isJsonCompatibleWithApplicationJson(ct)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        throw new ValidationError('body', '<malformed>', 'logout body must be valid JSON');
      }
      if (parsed !== null) {
        try {
          refreshToken = bindBody(LogoutRequest, parsed)?.refreshToken ?? null;
        } catch {
          throw new ValidationError('body', '<malformed>', 'logout body must be valid JSON');
        }
      }
    }
    if (refreshToken !== null) await svc.logout(refreshToken);
    const h = new Headers();
    for (const v of clearSessionCookies(auth)) h.append('Set-Cookie', v);
    return noContent(h);
  });

  r.post('/v1/auth/logout-all', { currentUser: true, tags: ['Auth'] }, async ({ c }) => {
    const user = await currentUser(c);
    await svc.logoutAll(user.id);
    const h = new Headers();
    for (const v of clearSessionCookies(auth)) h.append('Set-Cookie', v);
    return noContent(h);
  });

  r.get('/v1/auth/me', { currentUser: true, tags: ['Auth'] }, async ({ c }) =>
    svc.describe(await currentUser(c), { apiKey: apiKeyCredential(c) }));

  r.post('/v1/auth/api-keys', { body: CreateApiKeyRequest, currentUser: true, status: 201, argOrder: ['body', 'user'], tags: ['Auth'] },
    async ({ c, body }) => json(await svc.createApiKey(await currentUser(c), { apiKey: apiKeyCredential(c) }, body.name!, body.ttlDays, body.scopes), 201));

  r.get('/v1/auth/api-keys', { currentUser: true, tags: ['Auth'] }, async ({ c }) => svc.listApiKeys(await currentUser(c)));

  r.delete('/v1/auth/api-keys/{id}', { params: { id: param.uuid() }, currentUser: true, tags: ['Auth'] }, async ({ c, params }) => {
    const ok = await svc.revokeApiKey(await currentUser(c), { apiKey: apiKeyCredential(c) }, params.id!);
    return ok ? noContent() : emptyStatus(404);
  });

  // TokenAuthController
  r.post('/v1/auth/google/mobile', { body: GoogleMobileLoginRequest, tags: ['Auth'], summary: 'Exchange a Google ID token from the mobile app for an access + refresh token pair' },
    async ({ body }) => noStore(await svc.loginWithGoogle(body.idToken!, body.nonce, body.deviceName)));

  // Hidden and 404 while disabled; no @Valid so a disabled endpoint never answers 400 for missing fields.
  r.post('/v1/auth/review-login', { body: ReviewLoginRequest, bodyValidation: 'bindOnly', bodyOptional: true, hidden: true },
    async ({ body }) => {
      const b = body ?? { email: null, password: null, deviceName: null };
      const device = b.deviceName !== null && b.deviceName.length > 120 ? b.deviceName.slice(0, 120) : b.deviceName;
      return noStore(await svc.loginWithReviewCredentials(b.email, b.password, device));
    });

  r.post('/v1/auth/refresh', { body: RefreshRequest, tags: ['Auth'], summary: 'Rotate a refresh token; returns a new access + refresh token pair' },
    async ({ body }) => noStore(await svc.refresh(body.refreshToken!)));

  // DevLoginController: only with the dev profile AND AUTH_DEV_LOGIN_ENABLED=true.
  if (auth.devLoginEnabled) {
    r.post('/v1/auth/dev-login', { body: DevLoginRequest, hidden: true }, async ({ body }) => {
      const token = await svc.devLogin(body.email, body.name, body.staff ?? false);
      return noContent({ 'Set-Cookie': sessionCookie(auth, token) });
    });
  }
});

/** MediaType.APPLICATION_JSON.isCompatibleWith(contentType). */
function isJsonCompatibleWithApplicationJson(ct: string): boolean {
  const t = ct.split(';')[0]!.trim().toLowerCase();
  const [type, sub] = t.split('/');
  if (!type || sub === undefined) return false;
  if (type === '*') return true;
  if (type !== 'application') return false;
  return sub === 'json' || sub === '*' || sub === '*+json';
}
