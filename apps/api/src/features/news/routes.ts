// web/news/*: ArticleController, ArticleLinkPreviewController, NewsEventController,
// OrganizationController, OrgMembersController, VoteController, and the @orgAccess
// checks (OrgAccess) the policy's METHOD_RULES name.

import type { Deps } from '../../deps';
import { currentUser, principal } from '../../http/auth/context';
import { ArgumentTypeMismatchError, ResourceNotFoundError } from '../../http/errors';
import { defineRoutes, noContent, json } from '../../http/router';
import { param, type ParamSpec } from '../../http/validation';
import { ContentHmac } from '../crypto/logic/contentHmac';
import { MediaUploadService } from '../media/logic/mediaUploadService';
import { OrgAccess } from './access';
import { ArticleService, requireAuthorStatus } from './articles';
import {
  ArticleInput, ArticlePatchInput, InviteRequest, NewsEventInput, NewsEventPatchInput, OrganizationPatchRequest, OrganizationRequest,
  SettingsRequest, SignUploadRequest, UpdateMemberRequest, VoteRequest,
} from './dto';
import { EventRsvpService, NewsEventService, SIGNUP_NONE } from './events';
import { OrganizationMembershipService } from './memberships';
import { FollowService, OrgAnalyticsService, OrganizationService } from './organizations';
import { newsPaging } from './paging';
import { ArticleLinkPreviewService, NOT_FOUND_HTML, previewHtml } from './preview';
import { NewsSitemapService, dbSitemapSource, sitemapXml } from './sitemap';
import { VoteService } from './votes';
import { CONTENT_MAX_BODY_BYTES } from '../../http/body';

const ALL_STATUSES = 'all';

/** @RequestParam @DateTimeFormat(iso = DATE) LocalDate (optional). */
function isoDateParam(): ParamSpec<string | null> {
  return {
    javaType: 'java.time.LocalDate',
    parse(raw, name) {
      if (raw === undefined || raw.trim() === '') return null;
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
      const ok = m !== null && (() => {
        const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
        return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
      })();
      if (ok) return raw;
      throw new ArgumentTypeMismatchError(name, raw, 'java.time.LocalDate',
        'Failed to convert from type [java.lang.String] to type [@org.springframework.web.bind.annotation.RequestParam '
        + `@org.springframework.format.annotation.DateTimeFormat java.time.LocalDate] for value [${raw}]`);
    },
  };
}

/** The services of this feature (other features reuse them, e.g. web/user). */
export function newsServices(deps: Deps) {
  const memberships = new OrganizationMembershipService(deps);
  const articles = new ArticleService(deps, memberships);
  return {
    memberships,
    articles,
    events: new NewsEventService(deps, memberships),
    rsvps: new EventRsvpService(deps),
    organizations: new OrganizationService(deps, memberships),
    follows: new FollowService(deps),
    orgAnalytics: new OrgAnalyticsService(deps),
    votes: new VoteService(deps),
    previews: new ArticleLinkPreviewService(deps, articles),
    sitemap: new NewsSitemapService(dbSitemapSource(deps), deps.clock, deps.config.content.digest.publicBaseUrl),
    orgAccess: new OrgAccess(deps, memberships),
  };
}

export default defineRoutes((r, deps) => {
  const s = newsServices(deps);
  const access = s.orgAccess;
  access.register();
  let uploads: MediaUploadService | null = null;
  const mediaUploads = () => (uploads ??= new MediaUploadService(deps.storage,
    (rule, uid) => deps.userRateLimiter.consume(rule, uid),
    new ContentHmac(deps.config.auth.jwt.secret, deps.config.auth.contentHmacSecret)));

  // ---------------------------------------------------------------- articles
  const articleTags = ['article-controller'];
  r.get('/v1/articles', {
    tags: articleTags,
    query: {
      category: param.string({ required: false }), organization: param.string({ required: false }), status: param.string({ required: false }),
      mine: param.bool({ def: false }), page: param.int({ def: 1, primitive: true }), limit: param.int({ def: 20, primitive: true }),
    },
  }, async ({ c, query }) => {
    const p = principal(c);
    const paging = newsPaging(query.page!, query.limit!);
    if (query.mine) {
      const me = await access.currentUserId(p);
      const status = query.status === null || query.status.trim() === '' || query.status === ALL_STATUSES ? null : query.status;
      if (me === null) return { data: [], meta: { total: 0, page: paging.page + 1, limit: paging.size } };
      return s.articles.findOwnIndependent(query.category, status, me, paging);
    }
    const seesDrafts = access.isStaff(p) || (query.organization !== null && (await access.canReadDraftsOf(query.organization, p)));
    let effective: string | null = 'published';
    if (seesDrafts) {
      const st = query.status;
      effective = st === null || st.trim() === '' ? 'published' : st === ALL_STATUSES ? null : st;
    }
    return s.articles.findAll(query.category, query.organization, effective, null, paging);
  });

  r.get('/v1/articles/{id}', { tags: articleTags, params: { id: param.string() } }, async ({ c, params }) => {
    const p = principal(c);
    const includesDrafts = access.isStaff(p) || (await access.canReadArticleDraft(params.id!, p));
    return s.articles.getById(params.id!, includesDrafts);
  });

  r.post('/v1/articles', { tags: articleTags, body: ArticleInput, maxBodyBytes: CONTENT_MAX_BODY_BYTES, currentUser: true, status: 201 }, async ({ c, body: req }) => {
    const user = await currentUser(c);
    const independentAuthor = !access.isStaff(principal(c)) && access.isIndependent(req.organization);
    let status = req.status !== null ? req.status : 'published';
    let featured = req.featured!;
    if (independentAuthor) {
      status = requireAuthorStatus(req.status, true)!;
      featured = false;
    }
    return s.articles.create({
      id: independentAuthor ? null : req.id, title: req.title!, excerpt: req.excerpt!, body: req.body!, category: req.category!,
      authors: req.authors!, publishedAt: req.publishedAt, readingTime: req.readingTime, featured, colorScheme: req.colorScheme,
      coverImage: req.coverImage, status,
    }, req.organization, user.id);
  });

  r.patch('/v1/articles/{id}', { tags: articleTags, params: { id: param.string() }, body: ArticlePatchInput, maxBodyBytes: CONTENT_MAX_BODY_BYTES }, async ({ c, params, body: req }) => {
    const p = principal(c);
    const id = params.id!;
    const staff = access.isStaff(p);
    const viaAuthorship = !staff && !(await access.canWriteForArticle(id, req.organization, p));
    const independentAuthor = viaAuthorship ? await access.currentUserId(p) : null;
    const authorOnly = viaAuthorship && !(await access.canWriteForOrg(req.organization, p));
    if (authorOnly) requireAuthorStatus(req.status, false);
    const featured = authorOnly ? null : req.featured;
    const clear = req.publishedAt === null && req.clearPublishedAt === true;
    return s.articles.update(id, {
      title: req.title, excerpt: req.excerpt, body: req.body, category: req.category, authors: req.authors, publishedAt: req.publishedAt,
      readingTime: req.readingTime, colorScheme: req.colorScheme, coverImage: req.coverImage, status: req.status,
    }, featured, req.organization, independentAuthor, clear, req.expectedStatus);
  });

  r.delete('/v1/articles/{id}', { tags: articleTags, params: { id: param.string() } }, async ({ c, params }) => {
    const p = principal(c);
    const id = params.id!;
    if (access.isStaff(p)) await s.articles.delete(id, null);
    else if (await access.canDeleteArticle(id, p)) await s.articles.deleteAsOrgMember(id, await access.currentUserId(p));
    else await s.articles.delete(id, await access.currentUserId(p));
    return noContent();
  });

  r.get('/v1/articles/{id}/preview', {
    tags: ['Articles'], params: { id: param.string() },
    summary: 'Open Graph HTML for link previews of a published article (404 otherwise)',
  }, async ({ params }) => {
    const headers = { 'Content-Type': 'text/html;charset=UTF-8' };
    try {
      const html = previewHtml(await s.previews.preview(params.id!));
      return new Response(html, { status: 200, headers: { ...headers, 'Cache-Control': 'max-age=300, public' } });
    } catch (e) {
      if (e instanceof ResourceNotFoundError) return new Response(NOT_FOUND_HTML, { status: 404, headers });
      throw e;
    }
  });

  // NewsSitemapController: Caddy rewrites https://ceitba.org.ar/sitemap.xml here. Public
  // (GET /v1/articles/** is permitted); the literal segment wins over GET /{id}. No
  // `produces`, so Accept: text/html is not a 406.
  r.get('/v1/articles/sitemap.xml', {
    tags: ['Articles'], summary: 'sitemap.xml: the newsletter home, published articles and events',
  }, async () => new Response(sitemapXml(await s.sitemap.entries()), {
    status: 200,
    headers: { 'Content-Type': 'application/xml;charset=UTF-8', 'Cache-Control': 'max-age=3600, public' },
  }));

  // ---------------------------------------------------------------- votes
  const voteTags = ['vote-controller'];
  const voter = (c: Parameters<Parameters<typeof r.get>[2]>[0]['c']) => ({ ip: c.get('state').clientIp, ua: c.req.header('user-agent') ?? null });
  r.get('/v1/articles/{articleId}/votes', { tags: voteTags, params: { articleId: param.string() } }, ({ params }) => s.votes.getCounts(params.articleId!));
  r.post('/v1/articles/{articleId}/votes', { tags: voteTags, params: { articleId: param.string() }, body: VoteRequest }, ({ c, params, body }) => {
    const v = voter(c);
    return s.votes.cast(params.articleId!, v.ip, v.ua, body.type!);
  });
  r.delete('/v1/articles/{articleId}/votes', { tags: voteTags, params: { articleId: param.string() } }, async ({ c, params }) => {
    const v = voter(c);
    await s.votes.retract(params.articleId!, v.ip, v.ua);
    return noContent();
  });

  // ---------------------------------------------------------------- events
  const eventTags = ['news-event-controller'];
  r.get('/v1/news/events', {
    tags: eventTags,
    query: {
      category: param.string({ required: false }), organization: param.string({ required: false }),
      from: isoDateParam(), to: isoDateParam(),
      page: param.int({ def: 1, primitive: true }), limit: param.int({ def: 50, primitive: true }),
    },
  }, ({ query }) => s.events.findAll(query.category, query.organization, query.from, query.to, newsPaging(query.page!, query.limit!)));

  r.get('/v1/news/events/{id}', { tags: eventTags, params: { id: param.string() } }, ({ params }) => s.events.get(params.id!));

  r.post('/v1/news/events', { tags: eventTags, body: NewsEventInput, maxBodyBytes: CONTENT_MAX_BODY_BYTES, currentUser: true, status: 201 }, async ({ c, body: req }) => {
    const user = await currentUser(c);
    return s.events.create({
      id: req.id, title: req.title!, eventDate: req.eventDate!, startTime: req.startTime!, endTime: req.endTime!, location: req.location!,
      category: req.category!, description: req.description,
    }, req.organization, user.id, {
      coverImage: req.coverImage, onlineUrl: req.onlineUrl, signupMode: req.signupMode ?? SIGNUP_NONE, signupUrl: req.signupUrl, capacity: req.capacity,
    });
  });

  r.patch('/v1/news/events/{id}', { tags: eventTags, params: { id: param.string() }, body: NewsEventPatchInput, maxBodyBytes: CONTENT_MAX_BODY_BYTES }, ({ params, body: req }) =>
    s.events.update(params.id!, {
      title: req.title, eventDate: req.eventDate, startTime: req.startTime, endTime: req.endTime, location: req.location,
      category: req.category, description: req.description,
    }, req.organization, {
      coverImage: req.coverImage, onlineUrl: req.onlineUrl, signupMode: req.signupMode, signupUrl: req.signupUrl, capacity: req.capacity,
    }));

  r.delete('/v1/news/events/{id}', { tags: eventTags, params: { id: param.string() }, currentUser: true }, async ({ c, params }) => {
    const user = await currentUser(c);
    await s.events.delete(params.id!, access.isStaff(principal(c)) ? null : user.id);
    return noContent();
  });

  r.post('/v1/news/events/{id}/rsvp', { tags: eventTags, params: { id: param.string() }, currentUser: true }, async ({ c, params }) => {
    const user = await currentUser(c);
    return { going: true, rsvpCount: await s.rsvps.rsvp(params.id!, user.id) };
  });
  r.delete('/v1/news/events/{id}/rsvp', { tags: eventTags, params: { id: param.string() }, currentUser: true }, async ({ c, params }) => {
    const user = await currentUser(c);
    return { going: false, rsvpCount: await s.rsvps.cancel(params.id!, user.id) };
  });
  r.get('/v1/news/events/{id}/attendees', { tags: eventTags, params: { id: param.string() } }, async ({ params }) =>
    ({ data: await s.rsvps.attendees(params.id!) }));

  // ---------------------------------------------------------------- organizations
  const orgTags = ['Organizations'];
  r.get('/v1/organizations', { tags: orgTags }, async () => ({ data: await s.organizations.list() }));
  r.get('/v1/organizations/{slug}', { tags: orgTags, params: { slug: param.string() } }, ({ params }) => s.organizations.get(params.slug!));
  r.post('/v1/organizations', { tags: orgTags, body: OrganizationRequest }, async ({ body: req }) => {
    const created = await s.organizations.create(req.slug!, {
      name: req.name, fullName: req.fullName, description: req.description, category: req.category, color: req.color,
      logoUrl: req.logoUrl, backgroundUrl: req.backgroundUrl,
    }, {
      instagram: req.instagram, linkedinUrl: req.linkedinUrl, websiteUrl: req.websiteUrl, contactEmail: req.contactEmail,
      recruitingOpen: req.recruitingOpen, recruitingUrl: req.recruitingUrl, recruitingText: req.recruitingText,
    });
    return json(created, 201);
  });
  r.patch('/v1/organizations/{slug}', { tags: orgTags, params: { slug: param.string() }, body: OrganizationPatchRequest }, async ({ params, body: req }) =>
    s.organizations.update(params.slug!, {
      name: req.name, fullName: req.fullName, description: req.description, category: req.category, color: req.color,
      logoUrl: req.logoUrl, backgroundUrl: req.backgroundUrl,
    }, {
      instagram: req.instagram, linkedinUrl: req.linkedinUrl, websiteUrl: req.websiteUrl, contactEmail: req.contactEmail,
      recruitingOpen: req.recruitingOpen, recruitingUrl: req.recruitingUrl, recruitingText: req.recruitingText,
    }));
  r.delete('/v1/organizations/{slug}', { tags: orgTags, params: { slug: param.string() } }, async ({ params }) => {
    await s.organizations.delete(params.slug!);
    return noContent();
  });
  r.get('/v1/organizations/{slug}/followers', { tags: orgTags, params: { slug: param.string() } }, async ({ params }) => {
    const followers = await s.follows.listFollowers(params.slug!);
    return { data: followers, count: followers.length };
  });
  r.post('/v1/organizations/{slug}/media/sign-upload', {
    tags: orgTags, params: { slug: param.string() }, currentUser: true, body: SignUploadRequest,
  }, async ({ c, params, body: req }) => {
    const user = await currentUser(c);
    await s.organizations.requireExists(params.slug!);
    return mediaUploads().signOrgImage(params.slug!, user.id, { filename: req.filename!, contentType: req.contentType!, sizeBytes: req.sizeBytes! });
  });
  r.get('/v1/organizations/{slug}/analytics', {
    tags: orgTags, params: { slug: param.string() }, query: { days: param.int({ def: 30, primitive: true }) },
  }, ({ params, query }) => s.orgAnalytics.summary(params.slug!, query.days!));

  // ---------------------------------------------------------------- members
  const memberTags = ['Organizations'];
  const isStaffCaller = (c: Parameters<Parameters<typeof r.get>[2]>[0]['c']) => access.isStaff(principal(c));
  r.get('/v1/organizations/{slug}/members', {
    tags: memberTags, params: { slug: param.string() }, summary: "List the organization's members and pending invites (org admin or STAFF)",
  }, async ({ params }) => {
    const slug = params.slug!;
    return { members: await s.memberships.members(slug), invites: await s.memberships.invites(slug), settings: await s.memberships.settings(slug) };
  });
  r.post('/v1/organizations/{slug}/members/invites', {
    tags: memberTags, params: { slug: param.string() }, currentUser: true, body: InviteRequest,
    summary: 'Invite emails: existing users join now, others on their first login',
  }, async ({ c, params, body: req }) => {
    const user = await currentUser(c);
    return s.memberships.invite(params.slug!, req.emails, req.role, user.id);
  });
  r.delete('/v1/organizations/{slug}/members/invites', {
    tags: memberTags, params: { slug: param.string() }, query: { email: param.string() }, status: 204, summary: 'Revoke a pending invite',
  }, async ({ params, query }) => { await s.memberships.revokeInvite(params.slug!, query.email); });
  r.patch('/v1/organizations/{slug}/members/{userId}', {
    tags: memberTags, params: { slug: param.string(), userId: param.uuid() }, body: UpdateMemberRequest,
    summary: "Change a member's role, board title or portal visibility",
  }, async ({ c, params, body: req }) => {
    await s.memberships.update(params.userId!, params.slug!, req.role, req.title, req.showOnPortal, !isStaffCaller(c));
    return s.memberships.memberView(params.userId!, params.slug!);
  });
  r.delete('/v1/organizations/{slug}/members/{userId}', {
    tags: memberTags, params: { slug: param.string(), userId: param.uuid() }, status: 204, summary: 'Remove a member',
  }, async ({ c, params }) => { await s.memberships.remove(params.userId!, params.slug!, !isStaffCaller(c)); });
  r.post('/v1/organizations/{slug}/members/{userId}/transfer-admin', {
    tags: memberTags, params: { slug: param.string(), userId: param.uuid() }, currentUser: true, status: 204,
    summary: 'Make a member admin and step down to member (calling org admin)',
  }, async ({ c, params }) => {
    const user = await currentUser(c);
    await s.memberships.transferAdmin(params.slug!, user.id, params.userId!);
  });
  r.delete('/v1/organizations/{slug}/members/me', {
    tags: memberTags, params: { slug: param.string() }, currentUser: true, status: 204, summary: 'Leave the organization',
  }, async ({ c, params }) => {
    const user = await currentUser(c);
    await s.memberships.remove(user.id, params.slug!, true);
  });
  r.patch('/v1/organizations/{slug}/members/settings', {
    tags: memberTags, params: { slug: param.string() }, body: SettingsRequest, bodyValidation: 'bindOnly',
    summary: "Change the org's member settings (who sees RSVP lists)",
  }, ({ params, body }) => s.memberships.updateSettings(params.slug!, body.attendeesVisibleToMembers));

});
