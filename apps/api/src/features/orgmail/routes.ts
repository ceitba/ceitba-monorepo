// web/orgmail/OrgMailController. Access (STAFF or the org's admins) is in
// policy.ts METHOD_RULES; `orgAccess.canManageMembers` is registered by the
// news feature (src/features/news/access.ts).

import { defineRoutes, json } from '../../http/router';
import { jv, param } from '../../http/validation';
import { mailBeans } from '../mail/service';
import { requestParam } from '../mail/requestParam';
import { orgMailBeans } from './beans';
import { CONTENT_MAX_BODY_BYTES } from '../../http/body';
import { mailOAuthNonceCookie } from '../mail/logic/mailOAuthState';

// AnnouncementRequest(String subject, String body): no @Valid.
const AnnouncementRequest = jv.object({ subject: jv.string(), body: jv.string() });
// MailPreference(@NotNull Boolean enabled)
const MailPreference = jv.object({ enabled: jv.bool({ notNull: true }) });

export default defineRoutes((r, deps) => {
  const tags = ['Organizations'];
  const s = () => orgMailBeans(deps).service;
  const slug = { slug: param.string() };
  const slugId = { slug: param.string(), id: param.long() };

  r.get('/v1/organizations/{slug}/mail', { tags, params: slug, summary: "The org's connected Gmail account, its quota and the weekly cap" },
    ({ params }) => s().status(params.slug!));
  r.post('/v1/organizations/{slug}/mail/connect', { tags, params: slug, currentUser: true, summary: "Start connecting the org's Gmail account (Google consent URL)" },
    ({ params, user }) => {
      const { authorizationUrl, nonce } = mailBeans(deps).accounts.connectOrg(params.slug!, user!.id);
      return json({ authorizationUrl }, 200, { 'Set-Cookie': mailOAuthNonceCookie(deps.config.auth, nonce) });
    });
  r.delete('/v1/organizations/{slug}/mail', { tags, params: slug, status: 204, summary: "Disconnect the org's Gmail account" },
    async ({ params }) => { await mailBeans(deps).accounts.disconnectOrg(params.slug!); });
  r.get('/v1/organizations/{slug}/announcements', { tags, params: slug }, ({ params }) => s().list(params.slug!));
  r.post('/v1/organizations/{slug}/announcements', { tags, params: slug, currentUser: true, body: AnnouncementRequest, bodyValidation: 'bindOnly', maxBodyBytes: CONTENT_MAX_BODY_BYTES, status: 201 },
    ({ params, user, body }) => s().create(params.slug!, body.subject, body.body, user!.id));
  r.patch('/v1/organizations/{slug}/announcements/{id}', { tags, params: slugId, body: AnnouncementRequest, bodyValidation: 'bindOnly', maxBodyBytes: CONTENT_MAX_BODY_BYTES },
    ({ params, body }) => s().update(params.slug!, params.id!, body.subject, body.body));
  r.delete('/v1/organizations/{slug}/announcements/{id}', { tags, params: slugId, status: 204 },
    async ({ params }) => { await s().delete(params.slug!, params.id!); });
  r.post('/v1/organizations/{slug}/announcements/{id}/test', { tags, params: slugId, currentUser: true, status: 204, summary: 'Send the draft to the caller only' },
    async ({ params, user }) => { await s().sendTest(params.slug!, params.id!, user!); });
  r.post('/v1/organizations/{slug}/announcements/{id}/send', { tags, params: slugId, summary: "Send the draft to the org's followers" },
    ({ params }) => s().send(params.slug!, params.id!));

  r.post('/v1/org-mail/unsubscribe', { tags }, async ({ c }) => ({ organization: await s().unsubscribe(await requestParam(c, 'token')) }));

  r.get('/v1/me/follows/{slug}/mail', { tags, params: slug, currentUser: true },
    async ({ params, user }) => ({ enabled: await s().receivesMail(user!.id, params.slug!) }));
  r.put('/v1/me/follows/{slug}/mail', { tags, params: slug, currentUser: true, body: MailPreference }, async ({ params, user, body }) => {
    await s().setReceivesMail(user!.id, params.slug!, body.enabled!);
    return { enabled: body.enabled };
  });
});
