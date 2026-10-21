// web/mail/MailAccountController (STAFF, except the OAuth callback which is
// authenticated by the signed `state`) and web/mail/MailTrackingController
// (public open pixel and click redirects; they always answer).

import { defineRoutes, noContent } from '../../http/router';
import { param } from '../../http/validation';
import { digestBeans } from '../digest/beans';
import type { ClientInfo } from '../digest/tracking';
import type { AppContext } from '../../http/context';
import { mailBeans } from './service';

/** 1x1 transparent GIF (42 bytes). */
export const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

function client(c: AppContext): ClientInfo {
  return { userAgent: c.req.header('user-agent') ?? null, method: c.req.method, ip: c.get('state').clientIp ?? null };
}

export default defineRoutes((r, deps) => {
  const tags = ['Mail'];
  const accounts = () => mailBeans(deps).accounts;

  r.get('/v1/mail/accounts', { tags }, () => accounts().list());
  r.post('/v1/mail/accounts/ceitba/connect', { tags, currentUser: true },
    ({ user }) => ({ authorizationUrl: accounts().connect(user!.id) }));
  r.get('/v1/mail/accounts/oauth/callback', {
    tags, query: { code: param.string({ required: false }), state: param.string({ required: false }), error: param.string({ required: false }) },
  }, async ({ query }) => new Response(null, {
    status: 302,
    headers: { Location: await accounts().handleCallback(query.code, query.state, query.error), 'Cache-Control': 'no-store' },
  }));
  r.delete('/v1/mail/accounts/{id}', { tags, params: { id: param.long() } }, async ({ params }) => {
    await accounts().delete(params.id!);
    return noContent();
  });

  const log = deps.log.child({ component: 'MailTrackingController' });
  r.get('/v1/mail/o/{file}', { tags, params: { file: param.string() } }, async ({ c, params }) => {
    try {
      const file = params.file!;
      const id = file.endsWith('.gif') ? file.slice(0, -4) : file;
      await digestBeans(deps).tracking.open(id, client(c));
    } catch (e) {
      log.debug(`Open not recorded: ${String(e)}`);
    }
    return new Response(PIXEL, {
      status: 200,
      headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, must-revalidate, private', Pragma: 'no-cache', Expires: '0' },
    });
  });
  r.get('/v1/mail/c/{trackingId}/{linkId}', { tags, params: { trackingId: param.string(), linkId: param.string() } }, async ({ c, params }) => {
    const tracking = digestBeans(deps).tracking;
    let target: string;
    try {
      target = await tracking.click(params.trackingId!, params.linkId!, client(c));
    } catch (e) {
      log.debug(`Click not recorded: ${String(e)}`);
      target = tracking.fallbackUrl();
    }
    return new Response(null, { status: 302, headers: { Location: target, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  });
});
