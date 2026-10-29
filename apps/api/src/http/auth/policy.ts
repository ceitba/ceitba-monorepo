// The whole authorization policy, in one place like Java's:
//   1. URL_RULES      = config/SecurityConfig.authorizeHttpRequests, in the same
//                       order (first match wins), evaluated BEFORE routing;
//   2. METHOD_RULES   = every @PreAuthorize on a controller method (class-level
//                       ones expanded), keyed "METHOD /v1/path/{var}" exactly as
//                       the Java mapping, evaluated by the route wrapper AFTER the
//                       arguments are bound/validated and before the handler.
//
// Feature agents never edit this file: if a route needs a rule that is not
// here, report it. Checks that call feature logic (`@orgAccess.*`) are named
// here and implemented by the feature through `registerAccessCheck(name, fn)`.
//
// Outcomes (Spring Security):
//   URL rule denied, anonymous         -> 401, `WWW-Authenticate: Bearer`, empty body
//   URL rule denied, authenticated     -> 403, empty body, WWW-Authenticate with
//                                         error="insufficient_scope" for JWT sessions,
//                                         plain `Bearer` for API keys / sync key
//   METHOD rule denied (anyone)        -> 403 JSON {error: AccessDenied, message: "Insufficient permissions"}

import type { Role } from './principal';

export type Method = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';

export type UrlAccess =
  | 'permitAll'
  /** anyRequest().access(authenticated() AND emailAllowlisted) */
  | 'authenticatedAllowlisted'
  /** hasRole(X) only (no allowlist): /v1/sync/** */
  | { role: Role; allowlisted?: false }
  /** allOf(hasRole(X), emailAllowlisted) */
  | { role: Role; allowlisted: true };

export interface UrlRule {
  /** HttpMethod for requestMatchers(HttpMethod, ...); undefined = any method. */
  method?: Method;
  /** Spring MVC patterns relative to /api: `*` = one segment, `**` = rest (also zero segments). */
  patterns: string[];
  access: UrlAccess;
  /** Only present when the condition holds (dev login). */
  enabledWhen?: 'devLogin';
}

export const URL_RULES: readonly UrlRule[] = [
  // Local dev sign-in; otherwise the path is not even permitted.
  { method: 'POST', patterns: ['/v1/auth/dev-login'], access: 'permitAll', enabledWhen: 'devLogin' },
  {
    method: 'GET',
    patterns: [
      '/', '/health',
      '/actuator/health', '/actuator/health/liveness', '/actuator/health/readiness', '/actuator/info',
      '/docs', '/docs/**', '/docs.json', '/docs.json/**', '/v3/api-docs/**', '/swagger-ui/**',
      '/v1/careers/**',
      '/v1/subjects/**',
      '/v1/plans/**',
      '/v1/classrooms/**',
      '/v1/commissions',
      '/v1/wiki/bookmarks/*',
      '/v1/auth/google', '/v1/auth/callback',
      // Newsletter public reads
      '/v1/organizations/**',
      '/v1/articles/**',
      '/v1/news/events/**',
      // CeitbaPage CMS public reads (writes are @PreAuthorize'd)
      '/v1/staff-departments',
      '/v1/staff-members',
      '/v1/staff-members/years',
      '/v1/benefits',
      '/v1/benefit-cards',
      // Mobile home carousel (GET /v1/highlights/all is STAFF-only).
      '/v1/highlights',
      // Public read of share-session by token; writes are JWT-gated.
      '/v1/share/sessions/*',
      // Mobile app release control (min version / maintenance).
      '/v1/app/config',
      // Capabilities enabled for everyone (anonymous home page).
      '/v1/capabilities',
    ],
    access: 'permitAll',
  },
  // POST /v1/classrooms/conflicts is a read-style query (no writes); public.
  { method: 'POST', patterns: ['/v1/classrooms/conflicts'], access: 'permitAll' },
  // Vote casting and analytics ingestion are public (fingerprint-deduplicated)
  { method: 'POST', patterns: ['/v1/articles/*/votes'], access: 'permitAll' },
  { method: 'DELETE', patterns: ['/v1/articles/*/votes'], access: 'permitAll' },
  { method: 'POST', patterns: ['/v1/analytics/events'], access: 'permitAll' },
  // Weekly digest one-click unsubscribe (signed token; RFC 8058 target).
  { method: 'POST', patterns: ['/v1/digests/unsubscribe'], access: 'permitAll' },
  { method: 'POST', patterns: ['/v1/org-mail/unsubscribe'], access: 'permitAll' },
  // "¿Es así?" correction votes from the digest (signed per-reader token).
  { method: 'GET', patterns: ['/v1/digests/correction-vote'], access: 'permitAll' },
  { method: 'POST', patterns: ['/v1/digests/correction-vote'], access: 'permitAll' },
  // Digest open pixel and click redirects (opaque tracking ids).
  { method: 'GET', patterns: ['/v1/mail/o/*', '/v1/mail/c/*/*'], access: 'permitAll' },
  { method: 'HEAD', patterns: ['/v1/mail/o/*', '/v1/mail/c/*/*'], access: 'permitAll' },
  // Google redirects the browser here after the sender-account consent.
  { method: 'GET', patterns: ['/v1/mail/accounts/oauth/callback'], access: 'permitAll' },
  // Logout must be reachable with an expired cookie; the token endpoints authenticate via their body.
  { method: 'POST', patterns: ['/v1/auth/logout', '/v1/auth/google/mobile', '/v1/auth/refresh', '/v1/auth/review-login'], access: 'permitAll' },
  { patterns: ['/v1/sync/**'], access: { role: 'SYNC' } },
  // Proposal moderation is the narrow MODERATOR grant, not STAFF.
  { patterns: ['/v1/staff/proposals', '/v1/staff/proposals/**'], access: { role: 'MODERATOR', allowlisted: true } },
  // A still-valid JWT of an email dropped from the allowlist must not keep STAFF powers.
  { patterns: ['/v1/staff/**'], access: { role: 'STAFF', allowlisted: true } },
  { patterns: ['/**'], access: 'authenticatedAllowlisted' },
];

// ------------------------------------------------------------- method rules

export type MethodExpr =
  | { role: Role }
  /** `authentication instanceof JwtAuthenticationToken`: a JWT session, not an API key. */
  | { jwtSession: true }
  /** A feature-provided check; args are 'path.<var>' or 'body.<field>'. */
  | { check: string; args: string[] }
  | { or: MethodExpr[] }
  | { and: MethodExpr[] };

const role = (r: Role): MethodExpr => ({ role: r });
const jwtSession = (): MethodExpr => ({ jwtSession: true });
const check = (name: string, ...args: string[]): MethodExpr => ({ check: name, args });
const or = (...e: MethodExpr[]): MethodExpr => ({ or: e });
const and = (...e: MethodExpr[]): MethodExpr => ({ and: e });

/** Generated from the Java controllers (@PreAuthorize); keys match the OpenAPI paths. */
export const METHOD_RULES: Readonly<Record<string, MethodExpr>> = {
  'POST /v1/careers': role('STAFF'), // career/CareerController.java#createCareer
  'PUT /v1/careers/{id}': role('STAFF'), // career/CareerController.java#updateCareer
  'POST /v1/careers/{id}/plans': role('STAFF'), // career/CareerController.java#addPlan
  'PUT /v1/careers/{id}/plans/{planId}': role('STAFF'), // not in Java: rename a plan (/manage careers)
  'DELETE /v1/careers/{id}': role('STAFF'), // career/CareerController.java#deleteCareer
  'GET /v1/organizations/{slug}/mail': or(role('STAFF'), check('orgAccess.canManageMembers', 'path.slug')), // orgmail/OrgMailController.java#status
  'POST /v1/organizations/{slug}/mail/connect': check('orgAccess.canManageMembers', 'path.slug'), // orgmail/OrgMailController.java#connect
  'DELETE /v1/organizations/{slug}/mail': or(role('STAFF'), check('orgAccess.canManageMembers', 'path.slug')), // orgmail/OrgMailController.java#disconnect
  'GET /v1/organizations/{slug}/announcements': or(role('STAFF'), check('orgAccess.canManageMembers', 'path.slug')), // orgmail/OrgMailController.java#list
  'POST /v1/organizations/{slug}/announcements': or(role('STAFF'), check('orgAccess.canManageMembers', 'path.slug')), // orgmail/OrgMailController.java#create
  'PATCH /v1/organizations/{slug}/announcements/{id}': or(role('STAFF'), check('orgAccess.canManageMembers', 'path.slug')), // orgmail/OrgMailController.java#update
  'DELETE /v1/organizations/{slug}/announcements/{id}': or(role('STAFF'), check('orgAccess.canManageMembers', 'path.slug')), // orgmail/OrgMailController.java#delete
  'POST /v1/organizations/{slug}/announcements/{id}/test': or(role('STAFF'), check('orgAccess.canManageMembers', 'path.slug')), // orgmail/OrgMailController.java#sendTest
  'POST /v1/organizations/{slug}/announcements/{id}/send': or(role('STAFF'), check('orgAccess.canManageMembers', 'path.slug')), // orgmail/OrgMailController.java#send
  'GET /v1/staff/schedule-corrections': role('STAFF'), // correction/StaffScheduleCorrectionController.java#list
  'POST /v1/staff/schedule-corrections/{id}/apply': role('STAFF'), // correction/StaffScheduleCorrectionController.java#apply
  'POST /v1/staff/schedule-corrections/{id}/reject': role('STAFF'), // correction/StaffScheduleCorrectionController.java#reject
  'POST /v1/staff/kb/pipeline/runs': role('STAFF'), // kb/admin/StaffKbPipelineController.java#trigger
  'GET /v1/staff/kb/pipeline/runs': role('STAFF'), // kb/admin/StaffKbPipelineController.java#runs
  'GET /v1/staff/kb/pipeline/runs/{id}': role('STAFF'), // kb/admin/StaffKbPipelineController.java#run
  'GET /v1/staff/kb/pipeline/runs/{id}/progress': role('STAFF'), // kb/admin/StaffKbPipelineController.java#progress
  'POST /v1/staff/kb/pipeline/runs/{id}/cancel': role('STAFF'), // kb/admin/StaffKbPipelineController.java#cancel
  'POST /v1/staff/kb/pipeline/runs/{id}/approve-cost': role('STAFF'), // kb/admin/StaffKbPipelineController.java#approveCost
  'POST /v1/staff/kb/pipeline/baseline': role('STAFF'), // kb/admin/StaffKbPipelineController.java#baseline
  'GET /v1/staff/kb/pipeline/preview': role('STAFF'), // kb/admin/StaffKbPipelineController.java#preview
  'POST /v1/staff/kb/pipeline/probe': role('STAFF'), // kb/admin/StaffKbPipelineController.java#probe
  'POST /v1/staff/kb/pipeline/compare': role('STAFF'), // kb/admin/StaffKbPipelineController.java#compare
  'GET /v1/staff/kb/quota': role('STAFF'), // kb/admin/StaffKbAdminController.java#quota
  'GET /v1/staff/kb/settings': role('STAFF'), // kb/admin/StaffKbAdminController.java#settings
  'PUT /v1/staff/kb/settings': role('STAFF'), // kb/admin/StaffKbAdminController.java#update
  'POST /v1/staff/kb/settings/preview': role('STAFF'), // kb/admin/StaffKbAdminController.java#preview
  'GET /v1/staff/kb/settings/history': role('STAFF'), // kb/admin/StaffKbAdminController.java#history
  'POST /v1/staff/kb/settings/history/{id}/restore': role('STAFF'), // kb/admin/StaffKbAdminController.java#restore
  'GET /v1/staff/kb/models': role('STAFF'), // kb/admin/StaffKbAdminController.java#models
  'POST /v1/staff/kb/models': role('STAFF'), // kb/admin/StaffKbAdminController.java#create
  'PUT /v1/staff/kb/models/{id}': role('STAFF'), // kb/admin/StaffKbAdminController.java#updateModel
  'POST /v1/staff/kb/models/sync': role('STAFF'), // kb/admin/StaffKbAdminController.java#sync
  'POST /v1/staff/kb/models/{id}/probe': role('STAFF'), // kb/admin/StaffKbAdminController.java#probe
  'GET /v1/staff/kb/models/{id}/stage-cost': role('STAFF'), // kb/admin/StaffKbAdminController.java#stageCost
  'GET /v1/staff/kb/costs': role('STAFF'), // kb/admin/StaffKbAdminController.java#costs
  'GET /v1/staff/kb/costs/summary': role('STAFF'), // kb/admin/StaffKbAdminController.java#summary
  'GET /v1/staff/kb/costs/forecast': role('STAFF'), // kb/admin/StaffKbAdminController.java#forecast
  'POST /v1/staff/kb/costs/forecast': role('STAFF'), // kb/admin/StaffKbAdminController.java#forecastFor
  'GET /v1/staff/kb/endpoints': role('STAFF'), // kb/admin/StaffKbEndpointController.java#list
  'POST /v1/staff/kb/endpoints': role('STAFF'), // kb/admin/StaffKbEndpointController.java#create
  'PUT /v1/staff/kb/endpoints/{id}': role('STAFF'), // kb/admin/StaffKbEndpointController.java#update
  'DELETE /v1/staff/kb/endpoints/{id}': role('STAFF'), // kb/admin/StaffKbEndpointController.java#delete
  'POST /v1/staff/kb/endpoints/{id}/test': role('STAFF'), // kb/admin/StaffKbEndpointController.java#test
  'POST /v1/staff/kb/endpoints/{id}/discover': role('STAFF'), // kb/admin/StaffKbEndpointController.java#discover
  'GET /v1/staff/kb/endpoints/{id}/stats': role('STAFF'), // kb/admin/StaffKbEndpointController.java#stats
  'GET /v1/staff/kb/evals/sets': role('STAFF'), // kb/admin/StaffKbEvalController.java#sets
  'POST /v1/staff/kb/evals/sets': role('STAFF'), // kb/admin/StaffKbEvalController.java#createSet
  'POST /v1/staff/kb/evals/sets/{id}/refreeze': role('STAFF'), // kb/admin/StaffKbEvalController.java#refreeze
  'POST /v1/staff/kb/evals/estimate': role('STAFF'), // kb/admin/StaffKbEvalController.java#estimate
  'POST /v1/staff/kb/evals': role('STAFF'), // kb/admin/StaffKbEvalController.java#create
  'GET /v1/staff/kb/evals': role('STAFF'), // kb/admin/StaffKbEvalController.java#list
  'GET /v1/staff/kb/evals/leaderboard': role('STAFF'), // kb/admin/StaffKbEvalController.java#leaderboard
  'GET /v1/staff/kb/evals/{id}': role('STAFF'), // kb/admin/StaffKbEvalController.java#get
  'GET /v1/staff/kb/evals/{id}/progress': role('STAFF'), // kb/admin/StaffKbEvalController.java#progress
  'GET /v1/staff/kb/evals/{id}/review/progress': role('STAFF'), // kb/admin/StaffKbEvalController.java#reviewProgress
  'POST /v1/staff/kb/evals/{id}/cancel': role('STAFF'), // kb/admin/StaffKbEvalController.java#cancel
  'GET /v1/staff/kb/evals/{id}/pages': role('STAFF'), // kb/admin/StaffKbEvalController.java#page
  'GET /v1/staff/kb/evals/{id}/review/next': role('STAFF'), // kb/admin/StaffKbEvalController.java#next
  'POST /v1/staff/kb/evals/{id}/review': role('STAFF'), // kb/admin/StaffKbEvalController.java#review
  'POST /v1/staff/kb/evals/{id}/promote': role('STAFF'), // kb/admin/StaffKbEvalController.java#promote
  'POST /v1/staff/kb/subjects/{subjectId}/import': role('STAFF'), // kb/StaffKbController.java#importSubject
  'POST /v1/staff/kb/pages/{pageId}/hide': role('STAFF'), // kb/StaffKbController.java#hide
  'POST /v1/staff/kb/pages/{pageId}/restore': role('STAFF'), // kb/StaffKbController.java#restore
  'GET /v1/staff/kb/pages': role('STAFF'), // kb/StaffKbController.java#pages
  'GET /v1/highlights/all': role('STAFF'), // highlight/HighlightController.java#listAll
  'POST /v1/highlights': role('STAFF'), // highlight/HighlightController.java#create
  'PUT /v1/highlights/{id}': role('STAFF'), // highlight/HighlightController.java#update
  'DELETE /v1/highlights/{id}': role('STAFF'), // highlight/HighlightController.java#delete
  'GET /v1/mail/accounts': role('STAFF'), // mail/MailAccountController.java#list
  'POST /v1/mail/accounts/ceitba/connect': role('STAFF'), // mail/MailAccountController.java#connect
  'DELETE /v1/mail/accounts/{id}': role('STAFF'), // mail/MailAccountController.java#delete
  'POST /v1/plans/{planId}/subject': role('STAFF'), // plan/SubjectPlanController.java#create
  'PUT /v1/plans/{planId}/subject/{subjectId}': role('STAFF'), // plan/SubjectPlanController.java#update
  'DELETE /v1/plans/{planId}/subject/{subjectId}': role('STAFF'), // plan/SubjectPlanController.java#delete
  'GET /v1/digests': role('STAFF'), // digest/DigestController.java#list
  'GET /v1/digests/quota': role('STAFF'), // digest/DigestController.java#quota
  'POST /v1/digests': role('STAFF'), // digest/DigestController.java#create
  'GET /v1/digests/{id}': role('STAFF'), // digest/DigestController.java#get
  'GET /v1/digests/{id}/stats': role('STAFF'), // digest/DigestController.java#stats
  'PATCH /v1/digests/{id}': role('STAFF'), // digest/DigestController.java#patch
  'POST /v1/digests/{id}/test': role('STAFF'), // digest/DigestController.java#test
  'POST /v1/digests/{id}/send': role('STAFF'), // digest/DigestController.java#send
  'POST /v1/digests/{id}/cancel': role('STAFF'), // digest/DigestController.java#cancel
  'DELETE /v1/digests/{id}': role('STAFF'), // digest/DigestController.java#delete
  'GET /v1/staff/capabilities': role('STAFF'), // capability/StaffCapabilityController.java#list
  'PUT /v1/staff/capabilities/{key}': role('STAFF'), // capability/StaffCapabilityController.java#update
  'GET /v1/staff/capabilities/{key}/grants': role('STAFF'), // capability/StaffCapabilityController.java#grants
  'POST /v1/staff/capabilities/{key}/users': role('STAFF'), // capability/StaffCapabilityController.java#grantUsers
  'DELETE /v1/staff/capabilities/{key}/users/{email}': role('STAFF'), // capability/StaffCapabilityController.java#revokeUser
  'PUT /v1/staff/capabilities/{key}/orgs/{slug}': role('STAFF'), // capability/StaffCapabilityController.java#grantOrg
  'DELETE /v1/staff/capabilities/{key}/orgs/{slug}': role('STAFF'), // capability/StaffCapabilityController.java#revokeOrg
  'DELETE /v1/me': jwtSession(), // user/MeAccountController.java#deleteMe
  'GET /v1/users/{userId}/organizations': role('STAFF'), // user/UserMembershipsController.java#list
  'POST /v1/users/{userId}/organizations': role('STAFF'), // user/UserMembershipsController.java#add
  'PATCH /v1/users/{userId}/organizations/{slug}': role('STAFF'), // user/UserMembershipsController.java#updateRole
  'DELETE /v1/users/{userId}/organizations/{slug}': role('STAFF'), // user/UserMembershipsController.java#remove
  'POST /v1/users/create': role('STAFF'), // user/UserController.java#createUser
  'GET /v1/users': role('STAFF'), // user/UserController.java#getAllUsers
  'PATCH /v1/users/{id}/file-number': role('STAFF'), // user/UserController.java#updateFileNumber
  'GET /v1/users/{id}': role('STAFF'), // user/UserController.java#getUserById
  'GET /v1/staff/proposals': role('MODERATOR'), // proposal/StaffProposalController.java#list
  'POST /v1/staff/proposals/{id}/approve': role('MODERATOR'), // proposal/StaffProposalController.java#approve
  'POST /v1/staff/proposals/{id}/reject': role('MODERATOR'), // proposal/StaffProposalController.java#reject
  'PATCH /v1/staff/proposals/{id}': role('MODERATOR'), // proposal/StaffProposalController.java#setLifecycle
  'DELETE /v1/staff/proposals/{id}/comments/{commentId}': role('MODERATOR'), // proposal/StaffProposalController.java#deleteComment
  'DELETE /v1/news/events/{id}': or(role('STAFF'), check('orgAccess.canDeleteEvent', 'path.id')), // news/NewsEventController.java#delete
  'GET /v1/news/events/{id}/attendees': or(role('STAFF'), check('orgAccess.canSeeAttendees', 'path.id')), // news/NewsEventController.java#attendees
  'DELETE /v1/articles/{id}': or(role('STAFF'), check('orgAccess.canDeleteArticle', 'path.id'), check('orgAccess.canDeleteOwnIndependentArticle', 'path.id')), // news/ArticleController.java#delete
  'POST /v1/organizations': role('STAFF'), // news/OrganizationController.java#create
  'PATCH /v1/organizations/{slug}': or(role('STAFF'), check('orgAccess.canEditOrg', 'path.slug')), // news/OrganizationController.java#update
  'DELETE /v1/organizations/{slug}': role('STAFF'), // news/OrganizationController.java#delete
  'GET /v1/organizations/{slug}/followers': or(role('STAFF'), check('orgAccess.canViewFollowers', 'path.slug')), // news/OrganizationController.java#listFollowers
  'POST /v1/organizations/{slug}/media/sign-upload': or(role('STAFF'), check('orgAccess.canWriteForOrg', 'path.slug')), // news/OrganizationController.java#signUpload
  'GET /v1/organizations/{slug}/analytics': or(role('STAFF'), check('orgAccess.canWriteForOrg', 'path.slug')), // news/OrganizationController.java#analytics
  'GET /v1/organizations/{slug}/members': or(role('STAFF'), check('orgAccess.canManageMembers', 'path.slug')), // news/OrgMembersController.java#list
  'POST /v1/organizations/{slug}/members/invites': or(role('STAFF'), check('orgAccess.canManageMembers', 'path.slug')), // news/OrgMembersController.java#invite
  'DELETE /v1/organizations/{slug}/members/invites': or(role('STAFF'), check('orgAccess.canManageMembers', 'path.slug')), // news/OrgMembersController.java#revokeInvite
  'PATCH /v1/organizations/{slug}/members/{userId}': or(role('STAFF'), check('orgAccess.canManageMembers', 'path.slug')), // news/OrgMembersController.java#update
  'DELETE /v1/organizations/{slug}/members/{userId}': or(role('STAFF'), check('orgAccess.canManageMembers', 'path.slug')), // news/OrgMembersController.java#remove
  'POST /v1/organizations/{slug}/members/{userId}/transfer-admin': check('orgAccess.canManageMembers', 'path.slug'), // news/OrgMembersController.java#transferAdmin
  'PATCH /v1/organizations/{slug}/members/settings': or(role('STAFF'), check('orgAccess.canManageMembers', 'path.slug')), // news/OrgMembersController.java#updateSettings
  'GET /v1/study-groups': role('USER'), // studygroup/StudyGroupController.java#list
  'GET /v1/me/study-groups': role('USER'), // studygroup/StudyGroupController.java#mine
  'GET /v1/study-groups/{id}': role('USER'), // studygroup/StudyGroupController.java#get
  'POST /v1/study-groups': role('USER'), // studygroup/StudyGroupController.java#create
  'PATCH /v1/study-groups/{id}': role('USER'), // studygroup/StudyGroupController.java#update
  'DELETE /v1/study-groups/{id}': role('USER'), // studygroup/StudyGroupController.java#delete
  'POST /v1/study-groups/{id}/join': role('USER'), // studygroup/StudyGroupController.java#join
  'DELETE /v1/study-groups/{id}/membership': role('USER'), // studygroup/StudyGroupController.java#leave
  'POST /v1/benefit-cards': role('STAFF'), // staff/BenefitCardController.java#create
  'PUT /v1/benefit-cards/{id}': role('STAFF'), // staff/BenefitCardController.java#update
  'DELETE /v1/benefit-cards/{id}': role('STAFF'), // staff/BenefitCardController.java#delete
  'POST /v1/benefits/{slug}': role('STAFF'), // staff/BenefitController.java#create
  'PUT /v1/benefits/{slug}': role('STAFF'), // staff/BenefitController.java#update
  'DELETE /v1/benefits/{slug}': role('STAFF'), // staff/BenefitController.java#delete
  'GET /v1/staff/moderators': role('STAFF'), // staff/ModeratorController.java#list
  'POST /v1/staff/moderators': role('STAFF'), // staff/ModeratorController.java#grant
  'DELETE /v1/staff/moderators/{userId}': role('STAFF'), // staff/ModeratorController.java#revoke
  'PUT /v1/staff-departments/{slug}': role('STAFF'), // staff/StaffRosterController.java#updateDepartment
  'POST /v1/staff-members': role('STAFF'), // staff/StaffRosterController.java#createMember
  'PUT /v1/staff-members/{id}': role('STAFF'), // staff/StaffRosterController.java#updateMember
  'DELETE /v1/staff-members/{id}': role('STAFF'), // staff/StaffRosterController.java#deleteMember
  'POST /v1/staff/push/broadcast': role('STAFF'), // staff/PushBroadcastController.java#broadcast
  'GET /v1/staff/drive/sources': role('STAFF'), // drive/StaffDriveController.java#sources
  'POST /v1/staff/drive/sources/{id}/approve': role('STAFF'), // drive/StaffDriveController.java#approve
  'POST /v1/staff/drive/sources/{id}/block': role('STAFF'), // drive/StaffDriveController.java#block
  'GET /v1/staff/drive/files': role('STAFF'), // drive/StaffDriveController.java#files
  'POST /v1/staff/drive/files/{id}/publish': role('STAFF'), // drive/StaffDriveController.java#publish
  'POST /v1/staff/drive/files/{id}/remove': role('STAFF'), // drive/StaffDriveController.java#remove
  'POST /v1/staff/drive/files/{id}/restore': role('STAFF'), // drive/StaffDriveController.java#restore
  'POST /v1/staff/drive/reprocess': role('STAFF'), // drive/StaffDriveController.java#reprocess
  'GET /v1/staff/drive/unclaimed': role('STAFF'), // drive/StaffDriveController.java#unclaimed
  'GET /v1/analytics/summary': role('STAFF'), // analytics/AnalyticsController.java#summary
  'POST /v1/media/sign-upload': role('STAFF'), // media/MediaController.java#signUpload
  'POST /v1/news/events': or(role('STAFF'), check('orgAccess.canWriteForOrg', 'body.organization')),
  'PATCH /v1/news/events/{id}': or(role('STAFF'), check('orgAccess.canWriteForEvent', 'path.id', 'body.organization')),
  'POST /v1/articles': or(role('STAFF'), check('orgAccess.canWriteForOrg', 'body.organization'), and(role('USER'), check('orgAccess.isIndependent', 'body.organization'))),
  'PATCH /v1/articles/{id}': or(role('STAFF'), check('orgAccess.canWriteForArticle', 'path.id', 'body.organization'), check('orgAccess.canEditOwnIndependentArticle', 'path.id', 'body.organization')),
  'GET /v1/digests/{id}/preview': role('STAFF'), // digest/DigestController.java#preview
};

/** `{id:regex}` -> `{id}` (rule keys never carry the regex). */
export function ruleKey(method: string, springPath: string): string {
  return `${method.toUpperCase()} ${stripPathVariableRegexes(springPath)}`;
}

// Brace-depth aware: a regex such as `{id:[0-9a-f]{8}-[0-9a-f]{4}}` contains `}` itself, so a
// `[^}]*` scan would stop early, produce the wrong key and drop the route's @PreAuthorize rule.
export function stripPathVariableRegexes(springPath: string): string {
  let out = '';
  for (let i = 0; i < springPath.length; i++) {
    const m = springPath[i] === '{' ? /^\{(\w+):/.exec(springPath.slice(i)) : null;
    if (!m) { out += springPath[i]; continue; }
    let depth = 0;
    let j = i;
    for (; j < springPath.length; j++) {
      if (springPath[j] === '\\') { j++; continue; }
      if (springPath[j] === '{') depth++;
      else if (springPath[j] === '}' && --depth === 0) break;
    }
    out += `{${m[1]}}`;
    i = j;
  }
  return out;
}

// ------------------------------------------------------------- pattern matching

const compiled = new Map<string, RegExp>();

/** Spring MVC PathPattern semantics for the patterns used above. */
export function patternToRegExp(pattern: string): RegExp {
  let re = compiled.get(pattern);
  if (re) return re;
  if (pattern === '/**') re = /^\/.*$|^$/;
  else {
    const body = pattern.split('/').map((seg) => {
      if (seg === '**') return '\u0000';
      return seg.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*');
    }).join('/');
    re = new RegExp(`^${body.replace('/\u0000', '(?:/.*)?')}$`);
  }
  compiled.set(pattern, re);
  return re;
}

export function matchesPattern(pattern: string, path: string): boolean {
  return patternToRegExp(pattern).test(path);
}

export function matchUrlRule(method: string, path: string, opts: { devLogin: boolean }): UrlRule {
  const m = method.toUpperCase();
  for (const rule of URL_RULES) {
    if (rule.enabledWhen === 'devLogin' && !opts.devLogin) continue;
    if (rule.method && rule.method !== m) continue;
    if (rule.patterns.some((p) => matchesPattern(p, path))) return rule;
  }
  return URL_RULES[URL_RULES.length - 1]!;
}
