// web/capability/CapabilityController + StaffCapabilityController (STAFF via
// /v1/staff/** and METHOD_RULES).

import { defineRoutes } from '../../http/router';
import { param } from '../../http/validation';
import { GrantUsersRequest, UpdateCapabilityRequest, type PublicCapabilitiesResponse } from './dto';
import { CapabilityAdminService, CapabilityService } from './service';

export default defineRoutes((r, deps) => {
  const caps = new CapabilityService(deps);
  const admin = new CapabilityAdminService(deps);
  const staffTags = ['Staff'];

  r.get('/v1/capabilities', { tags: ['Capabilities'], summary: 'Capability keys enabled for every user (public)' },
    async (): Promise<PublicCapabilitiesResponse> => ({ enabledForAll: await caps.enabledForAll() }));

  r.get('/v1/staff/capabilities', { tags: staffTags, summary: 'Every capability in the registry with its global switch and grant counts' },
    () => admin.list());

  r.put('/v1/staff/capabilities/{key}', {
    tags: staffTags, summary: 'Enable or disable a capability for every user (404 unknown key)',
    params: { key: param.string() }, body: UpdateCapabilityRequest, currentUser: true, argOrder: ['user', 'params', 'body'],
  }, ({ params, body, user }) => admin.setEnabledForAll(params.key!, body.enabledForAll!, user?.id ?? null));

  r.get('/v1/staff/capabilities/{key}/grants', { tags: staffTags, summary: 'Email and organization grants of a capability', params: { key: param.string() } },
    ({ params }) => admin.grants(params.key!));

  r.post('/v1/staff/capabilities/{key}/users', {
    tags: staffTags, summary: 'Grant a capability to emails (trimmed, lowercased, deduped; 400 on a malformed email); returns the updated grants',
    params: { key: param.string() }, body: GrantUsersRequest, currentUser: true, argOrder: ['user', 'params', 'body'],
  }, ({ params, body, user }) => admin.grantUsers(params.key!, body.emails!, user?.id ?? null));

  r.delete('/v1/staff/capabilities/{key}/users/{email}', {
    tags: staffTags, summary: 'Revoke an email grant (no-op when missing); returns the updated grants',
    params: { key: param.string(), email: param.string() },
  }, ({ params }) => admin.revokeUser(params.key!, params.email!));

  r.put('/v1/staff/capabilities/{key}/orgs/{slug}', {
    tags: staffTags, summary: 'Grant a capability to every member of an organization (404 unknown org); returns the updated grants',
    params: { key: param.string(), slug: param.string() }, currentUser: true, argOrder: ['user', 'params'],
  }, ({ params, user }) => admin.grantOrg(params.key!, params.slug!, user?.id ?? null));

  r.delete('/v1/staff/capabilities/{key}/orgs/{slug}', {
    tags: staffTags, summary: 'Revoke an organization grant (no-op when missing); returns the updated grants',
    params: { key: param.string(), slug: param.string() },
  }, ({ params }) => admin.revokeOrg(params.key!, params.slug!));
});
