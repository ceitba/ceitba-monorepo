// service/news/NewsPushes: follower notifications for newsletter content. The
// app deep-links on data.type ("article" | "event") + data.id; data.org is the
// org slug.

import { javaIsBlank } from '../../lib/javaCompat';
import { pushMessage } from '../push/service';
import type { PushTrigger } from './pushTriggers';
import type { OrgRow } from './repo';

export const TYPE_ARTICLE = 'article';
export const TYPE_EVENT = 'event';

/** NewsPushes.forOrg: none without an organization or a body. */
export function orgPush(org: OrgRow | null | undefined, body: string | null, type: string, id: string): PushTrigger | null {
  if (!org || body === null || javaIsBlank(body)) return null;
  const title = org.name != null && !javaIsBlank(org.name) ? org.name : org.slug;
  return { kind: 'orgFollowers', orgSlug: org.slug, message: pushMessage(title, body, { type, id, org: org.slug }) };
}
