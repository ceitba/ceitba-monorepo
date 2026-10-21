// web/digest/DigestController. Issue endpoints are STAFF-only (policy.ts
// METHOD_RULES); subscription is any signed-in user (+ resumen_semanal);
// unsubscribe and the correction vote are public (signed tokens). {id} only
// matches a UUID, so the literal paths never collide with it.

import { defineRoutes, noContent } from '../../http/router';
import { param } from '../../http/validation';
import { CapabilityService } from '../capability/service';
import { requestParam } from '../mail/requestParam';
import { mailBeans } from '../mail/service';
import { digestBeans } from './beans';
import { CorrectionVoteRequest, CreateRequest, PatchRequest, SubscriptionRequest } from './dto';

// The Java mapping's {id:[0-9a-fA-F]{8}-...{12}} with the {n} quantifiers spelled out: policy.ts ruleKey()
// cuts a regex at its first '}', so a quantifier would break the METHOD_RULES lookup (reported).
const H = '[0-9a-fA-F]';
const ID = `/{id:${H.repeat(8)}-${H.repeat(4)}-${H.repeat(4)}-${H.repeat(4)}-${H.repeat(12)}}`;

export default defineRoutes((r, deps) => {
  const tags = ['Digest'];
  const b = () => digestBeans(deps);
  const id = { id: param.uuid() };

  r.get('/v1/digests', { tags }, () => b().service.list());
  r.get('/v1/digests/quota', { tags }, async () => ({ ...(await b().service.quota()), senderStatus: await mailBeans(deps).accounts.senderStatus() }));
  r.post('/v1/digests', { tags, body: CreateRequest, status: 201 }, ({ body }) => b().service.create(body));
  r.get(`/v1/digests${ID}`, { tags, params: id }, ({ params }) => b().service.detail(params.id!));
  r.get(`/v1/digests${ID}/stats`, { tags, params: id }, ({ params }) => b().service.stats(params.id!));
  r.patch(`/v1/digests${ID}`, { tags, params: id, body: PatchRequest }, ({ params, body }) => b().service.patch(params.id!, body));
  r.get(`/v1/digests${ID}/preview`, { tags, params: id, query: { mode: param.string({ required: false }) }, currentUser: true },
    async ({ params, user }) => new Response(await b().service.previewHtml(params.id!, user!.id), {
      status: 200, headers: { 'Content-Type': 'text/html;charset=UTF-8' },
    }));
  r.post(`/v1/digests${ID}/test`, { tags, params: id, currentUser: true },
    async ({ params, user }) => ({ sentTo: await b().service.sendTest(params.id!, user!.id) }));
  r.post(`/v1/digests${ID}/send`, { tags, params: id, currentUser: true, status: 202 },
    ({ params, user }) => b().service.send(params.id!, user!.id));
  r.post(`/v1/digests${ID}/cancel`, { tags, params: id }, ({ params }) => b().service.cancel(params.id!));
  r.delete(`/v1/digests${ID}`, { tags, params: id }, async ({ params }) => {
    await b().service.delete(params.id!);
    return noContent();
  });

  r.get('/v1/digests/subscription', { tags, currentUser: true }, async ({ user }) => {
    await new CapabilityService(deps).require(user, 'resumen_semanal');
    return { enabled: await b().service.isSubscribed(user!.id) };
  });
  r.put('/v1/digests/subscription', { tags, body: SubscriptionRequest, currentUser: true }, async ({ body, user }) => {
    await new CapabilityService(deps).require(user, 'resumen_semanal');
    return { enabled: await b().service.setSubscribed(user!.id, body.enabled!) };
  });

  r.get('/v1/digests/correction-vote', { tags, query: { token: param.string({ required: false }) } },
    ({ query }) => b().votes.view(query.token));
  r.post('/v1/digests/correction-vote', { tags, body: CorrectionVoteRequest },
    ({ body }) => b().votes.vote(body.token, body.vote));

  r.post('/v1/digests/unsubscribe', { tags }, async ({ c }) => {
    await b().service.unsubscribe(await requestParam(c, 'token'));
    return noContent();
  });
});
