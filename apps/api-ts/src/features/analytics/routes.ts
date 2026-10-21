// web/analytics/AnalyticsController. Ingest is public (policy URL rule); the summary is STAFF (METHOD_RULES).

import { z } from 'zod';
import { defineRoutes, emptyStatus } from '../../http/router';
import { jv, param } from '../../http/validation';
import { AnalyticsService } from './service';

/** AnalyticsEventBatch(@NotNull @Size(min = 1, max = 50, message = ...) @Valid List<EventDto> events). */
const EventList = jv.list(jv.object({
    type: jv.string({ notNull: true }),
    sessionId: jv.string({ notNull: true }),
    timestamp: jv.long(),
    articleId: jv.string(),
    eventId: jv.string({ size: { max: 64 } }),
    category: jv.string(),
    path: jv.string(),
}), { notNull: true });

/** The @Size(message = ...) counts the raw list, also when elements fail their own constraints. */
const AnalyticsEventBatch = jv.object({
  events: z.any().transform((v: unknown, ctx) => {
    const r = EventList.safeParse(v);
    if (!r.success) for (const iss of r.error.issues) ctx.addIssue(iss as never);
    if (Array.isArray(v) && (v.length < 1 || v.length > 50)) {
      const message = 'Batch must contain between 1 and 50 events';
      ctx.addIssue({ code: 'custom', message, params: { bean: { literal: message } } });
    }
    return r.success ? r.data : z.NEVER;
  }),
});

export default defineRoutes((r, deps) => {
  const svc = new AnalyticsService(deps);
  r.post('/v1/analytics/events', { tags: ['analytics-controller'], body: AnalyticsEventBatch }, async ({ body, c }) => {
    const events = body.events!.map((e) => ({
      type: e!.type!, sessionId: e!.sessionId!, timestamp: e!.timestamp, articleId: e!.articleId, eventId: e!.eventId, category: e!.category, path: e!.path,
    }));
    // ClientIp.resolve with rate-limit.trust-forwarded-for, like the rate limiter.
    await svc.ingestBatch(events, c.get('state').clientIp);
    return emptyStatus(202);
  });
  r.get('/v1/analytics/summary', { tags: ['analytics-controller'], query: { days: param.int({ def: 30, primitive: true }) } },
    ({ query }) => svc.summary(query.days!));
});
