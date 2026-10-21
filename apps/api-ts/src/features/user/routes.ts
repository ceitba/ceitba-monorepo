// web/user/{MeAccountController, MeDevicesController, MeFollowsController,
// MeOrganizationsController, MeProfileController, MeRsvpsController,
// MeSchedulesController, UserController, UserMembershipsController}.
// /v1/me/** is authenticated + allowlisted (URL rules); /v1/users/** is STAFF
// through METHOD_RULES; DELETE /v1/me requires a JWT session (API keys 403).

import { clearSessionCookies } from '../../http/auth/cookies';
import type { AppContext } from '../../http/context';
import { MalformedBodyError, UnsupportedMediaTypeError } from '../../http/errors';
import { resolveRequestLocale } from '../../http/locale';
import { JSON_TYPE, defineRoutes, noContent } from '../../http/router';
import { param, validateBody } from '../../http/validation';
import { toJavaJson } from '../../lib/json';
import {
  AddMembershipRequest, CreateUserRequest, RegisterDeviceRequest, SaveScheduleRequest, UpdateFileNumberRequest, UpdateMembershipRequest,
  UpdatePreferencesRequest, UpdateProfileRequest, type SavedScheduleResponse,
} from './dto';
import { AccountDeletionService } from './accountDeletion';
import { field, JsonSyntaxError, parseJackson, spliceRawJson } from './logic/jacksonTree';
import { DeviceService, MeSocialService, SavedScheduleService, UserProfileService, UserService, type SaveSchedule } from './service';

const PAYLOAD = `__payload_${crypto.randomUUID()}__`;

/** SavedScheduleResponse JSON (payload spliced in as Jackson wrote it; isPrimary last). */
function scheduleJson(s: SavedScheduleResponse): string {
  const { payloadJson, ...rest } = s;
  const obj = { id: rest.id, name: rest.name, careerId: rest.careerId, plan: rest.plan, payload: PAYLOAD, createdAt: rest.createdAt, updatedAt: rest.updatedAt, isPrimary: rest.isPrimary };
  return spliceRawJson(toJavaJson(obj), new Map([[PAYLOAD, payloadJson]]));
}
const scheduleResponse = (s: SavedScheduleResponse, status = 200) => new Response(scheduleJson(s), { status, headers: { 'Content-Type': JSON_TYPE } });

function isJsonCompatible(ct: string): boolean {
  const t = ct.split(';')[0]!.trim().toLowerCase();
  return t === 'application/json' || /^application\/[^/]+\+json$/.test(t) || t === '*/*' || t === 'application/*';
}

/** MediaType.toString() + charset=UTF-8 (the router's 415 message). */
function normalizeMediaType(ct: string): string {
  const [type, ...params] = ct.split(';').map((s) => s.trim()).filter(Boolean);
  const ps = params.map((p) => p.replace(/\s*=\s*/, '='));
  if (!ps.some((p) => p.toLowerCase().startsWith('charset='))) ps.push('charset=UTF-8');
  return [type!.toLowerCase(), ...ps].join(';');
}

/**
 * `@Valid @RequestBody SaveScheduleRequest` read from the raw text, so the
 * opaque payload keeps Jackson's key order and number types (a JS object
 * would move integer-like keys first and print 1.0 as 1). Same 415/400 rules
 * as the router's body binding.
 */
function readSaveSchedule(c: AppContext, raw: string, defaultLocale: Parameters<typeof resolveRequestLocale>[1]): SaveSchedule {
  const ct = c.req.header('content-type');
  if (!ct) {
    if (raw.length === 0) throw new MalformedBodyError();
    throw new UnsupportedMediaTypeError('application/octet-stream');
  }
  if (!isJsonCompatible(ct)) throw new UnsupportedMediaTypeError(normalizeMediaType(ct));
  if (raw.length === 0) throw new MalformedBodyError();
  let parsed: unknown;
  let tree;
  try {
    parsed = JSON.parse(raw);
    tree = parseJackson(raw);
  } catch (e) {
    if (e instanceof SyntaxError || e instanceof JsonSyntaxError) throw new MalformedBodyError();
    throw e;
  }
  const body = validateBody(SaveScheduleRequest, parsed, resolveRequestLocale(c.req.header('accept-language'), defaultLocale));
  return { name: body!.name!, careerId: body!.careerId, plan: body!.plan, payload: field(tree, "payload")! };
}

export default defineRoutes((r, deps) => {
  const users = new UserService(deps);
  const profiles = new UserProfileService(deps);
  const devices = new DeviceService(deps);
  const schedules = new SavedScheduleService(deps);
  const me = new MeSocialService(deps);
  const deletion = new AccountDeletionService(deps);
  const locale = deps.config.server.defaultLocale;
  const meTags = ['Me'];

  // ---- MeAccountController
  r.delete('/v1/me', {
    tags: meTags, currentUser: true,
    summary: 'Delete the current user\'s account and personal data; revokes all refresh tokens and API keys. Requires a JWT session (API keys get 403); 409 if the caller is the only active staff member',
  }, async ({ user }) => {
    await deletion.deleteAccount(user!.id);
    const h = new Headers();
    for (const cookie of clearSessionCookies(deps.config.auth)) h.append('Set-Cookie', cookie);
    return noContent(h);
  });

  // ---- MeDevicesController
  r.get('/v1/me/devices', { tags: meTags, currentUser: true, summary: "List the current user's registered push devices, most recently seen first" },
    ({ user }) => devices.list(user!.id));
  r.put('/v1/me/devices', {
    tags: meTags, currentUser: true, body: RegisterDeviceRequest, argOrder: ['user', 'body'],
    summary: "Register (or refresh) this install's FCM token. Idempotent; a token registered to another account is moved to the caller. Call after login and on every token refresh",
  }, ({ user, body }) => devices.register(user!.id, body.token!, body.platform!, body.appVersion));
  r.delete('/v1/me/devices/{token}', {
    tags: meTags, currentUser: true, params: { token: param.string() }, argOrder: ['user', 'params'],
    summary: 'Unregister a device token (call on logout). Always 204: unknown tokens and tokens of other users are ignored',
  }, async ({ user, params }) => { await devices.unregister(user!.id, params.token!); return noContent(); });

  // ---- MeFollowsController
  r.get('/v1/me/follows', { currentUser: true }, ({ user }) => me.follows(user!.id));
  r.post('/v1/me/follows/{slug}', { params: { slug: param.string() }, currentUser: true, status: 201 },
    ({ params, user }) => me.follow(user!.id, params.slug!));
  r.delete('/v1/me/follows/{slug}', { params: { slug: param.string() }, currentUser: true },
    async ({ params, user }) => { await me.unfollow(user!.id, params.slug!); return noContent(); });

  // ---- MeOrganizationsController / MeRsvpsController
  r.get('/v1/me/organizations', { currentUser: true }, ({ user }) => me.memberships(user!.id));
  r.get('/v1/me/rsvps', { currentUser: true }, ({ user }) => me.rsvps(user!.id));

  // ---- MeProfileController
  r.get('/v1/me/preferences', { tags: meTags, currentUser: true, summary: "Get current user's theme and language" },
    ({ user }) => profiles.getPreferences(user!.id));
  r.patch('/v1/me/preferences', {
    tags: meTags, currentUser: true, body: UpdatePreferencesRequest, argOrder: ['user', 'body'],
    summary: 'Update theme and/or language. Null fields are left alone; empty string clears.',
  }, ({ user, body }) => profiles.updatePreferences(user!.id, body));
  r.get('/v1/me/profile', { tags: meTags, currentUser: true, summary: "Get current user's career, plan, file number and social handles" },
    ({ user }) => profiles.getProfile(user!.id));
  r.patch('/v1/me/profile', {
    tags: meTags, currentUser: true, body: UpdateProfileRequest, argOrder: ['user', 'body'],
    summary: 'Update career, plan, social handles and/or set the file number once',
  }, ({ user, body }) => profiles.updateProfile(user!.id, body));

  // ---- MeSchedulesController
  r.get('/v1/me/schedules', { tags: meTags, currentUser: true, summary: "List the user's saved schedules (most recent first)" },
    async ({ user }) => {
      const list = await schedules.list(user!.id);
      return new Response(`[${list.map(scheduleJson).join(',')}]`, { status: 200, headers: { 'Content-Type': JSON_TYPE } });
    });
  r.get('/v1/me/schedules/{id}', { tags: meTags, currentUser: true, params: { id: param.uuid() }, argOrder: ['user', 'params'], summary: 'Get one saved schedule by id' },
    async ({ user, params }) => scheduleResponse(await schedules.get(user!.id, params.id!)));
  r.post('/v1/me/schedules', {
    tags: meTags, currentUser: true, rawBody: true, argOrder: ['user', 'body'],
    summary: "Save a new schedule (the user's first one becomes primary). 409 if the per-user limit is reached.",
  }, async ({ c, user, rawBody }) => scheduleResponse(await schedules.create(user!.id, readSaveSchedule(c, rawBody ?? '', locale)), 201));
  r.put('/v1/me/schedules/{id}', {
    tags: meTags, currentUser: true, params: { id: param.uuid() }, rawBody: true, argOrder: ['user', 'params', 'body'],
    summary: 'Replace name/payload of an existing saved schedule (isPrimary is unchanged)',
  }, async ({ c, user, params, rawBody }) => scheduleResponse(await schedules.update(user!.id, params.id!, readSaveSchedule(c, rawBody ?? '', locale))));
  r.put('/v1/me/schedules/{id}/primary', {
    tags: meTags, currentUser: true, params: { id: param.uuid() }, argOrder: ['user', 'params'],
    summary: "Make this the user's primary schedule (clears the previous primary). Idempotent.",
  }, async ({ user, params }) => scheduleResponse(await schedules.makePrimary(user!.id, params.id!)));
  r.delete('/v1/me/schedules/{id}', {
    tags: meTags, currentUser: true, params: { id: param.uuid() }, argOrder: ['user', 'params'], status: 204,
    summary: 'Delete a saved schedule. Deleting the primary leaves the user with no primary.',
  }, async ({ user, params }) => { await schedules.delete(user!.id, params.id!); });

  // ---- UserController (STAFF)
  const userTags = ['Users'];
  r.post('/v1/users/create', { tags: userTags, body: CreateUserRequest, status: 201, summary: 'Create a user with academic metadata (STAFF only)' },
    ({ body }) => users.create(body));
  r.get('/v1/users', {
    tags: userTags, summary: 'List users with optional q/organization/staff filter, sort, and pagination (STAFF only)',
    query: {
      q: param.string({ required: false }), organization: param.string({ required: false }), staff: param.bool({ def: false }),
      sort: param.string({ def: 'newest' }), page: param.int({ def: 1, primitive: true }), limit: param.int({ def: 20, primitive: true }),
    },
  }, ({ query }) => users.findPaged(query.q, query.organization, query.staff!, query.sort!, query.page!, query.limit!));
  r.patch('/v1/users/{id}/file-number', {
    tags: userTags, params: { id: param.uuid() }, body: UpdateFileNumberRequest, summary: "Set, change or clear a user's file number (STAFF only)",
  }, ({ params, body }) => users.updateFileNumber(params.id!, body.fileNumber));
  r.get('/v1/users/{id}', { tags: userTags, params: { id: param.uuid() }, summary: 'Get a user by ID (STAFF only)' },
    ({ params }) => users.getById(params.id!));

  // ---- UserMembershipsController (STAFF)
  r.get('/v1/users/{userId}/organizations', { tags: userTags, params: { userId: param.uuid() }, summary: "List a user's organization memberships (STAFF only)" },
    ({ params }) => me.memberships(params.userId!));
  r.post('/v1/users/{userId}/organizations', {
    tags: userTags, params: { userId: param.uuid() }, body: AddMembershipRequest, status: 201, summary: 'Add a user to an organization (STAFF only)',
  }, ({ params, body }) => me.addMembership(params.userId!, body.slug!, body.role));
  r.patch('/v1/users/{userId}/organizations/{slug}', {
    tags: userTags, params: { userId: param.uuid(), slug: param.string() }, body: UpdateMembershipRequest, summary: "Change a user's role in an organization (STAFF only)",
  }, ({ params, body }) => me.updateMembershipRole(params.userId!, params.slug!, body.role!));
  r.delete('/v1/users/{userId}/organizations/{slug}', {
    tags: userTags, params: { userId: param.uuid(), slug: param.string() }, status: 204, summary: 'Remove a user from an organization (STAFF only)',
  }, async ({ params }) => { await me.removeMembership(params.userId!, params.slug!); });
});
