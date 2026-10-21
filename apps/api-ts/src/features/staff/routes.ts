// web/staff/{StaffController, ModeratorController, StaffRosterController,
// BenefitController, BenefitCardController, PushBroadcastController}.
// STAFF writes are enforced by policy.ts (URL rule /v1/staff/** + METHOD_RULES).

import { defineRoutes } from '../../http/router';
import { param } from '../../http/validation';
import { systemNowMicros } from '../../lib/time';
import { PushBroadcastService } from '../push/broadcast';
import {
  AssignStaffRequest, CreateBenefitCardRequest, CreateStaffMemberRequest, GrantModeratorRequest, PushBroadcastRequest,
  UpdateBenefitCardRequest, UpdateBenefitRequest, UpdateStaffDepartmentRequest, UpdateStaffMemberRequest,
} from './dto';
import { BenefitCardService, BenefitService, ModeratorService, StaffRosterService, StaffService } from './service';

export default defineRoutes((r, deps) => {
  const staff = new StaffService(deps);
  const moderators = new ModeratorService(deps);
  const roster = new StaffRosterService(deps);
  const benefits = new BenefitService(deps);
  const cards = new BenefitCardService(deps);
  const broadcasts = new PushBroadcastService(deps);

  // ---- StaffController (/v1/staff/**: STAFF in SecurityConfig)
  const staffTags = ['Staff'];
  r.get('/v1/staff', { tags: staffTags, summary: 'List currently active staff members' }, () => staff.listActive());
  r.post('/v1/staff', { tags: staffTags, summary: 'Assign STAFF role to a user (creates a CeitbaStaff row)', body: AssignStaffRequest, status: 201 },
    ({ body }) => staff.assign(body));
  r.delete('/v1/staff/{userId}', { tags: staffTags, summary: 'Revoke STAFF (end-dates the membership at now)', params: { userId: param.uuid() }, status: 204 },
    async ({ params }) => { await staff.revoke(params.userId!); });

  // ---- ModeratorController
  r.get('/v1/staff/moderators', { tags: staffTags, summary: 'List active MODERATOR grants (active STAFF are moderators implicitly and are not listed)' },
    () => moderators.listActive());
  r.post('/v1/staff/moderators', {
    tags: staffTags, summary: 'Grant MODERATOR to a user by email (404 unknown user, 409 already a moderator)',
    body: GrantModeratorRequest, currentUser: true, argOrder: ['user', 'body'], status: 201,
  }, ({ body, user }) => moderators.grant(body.email!, user?.id ?? null));
  r.delete('/v1/staff/moderators/{userId}', {
    tags: staffTags, summary: 'Revoke a MODERATOR grant (kept for audit; 404 when there is no active grant)',
    params: { userId: param.uuid() }, currentUser: true, argOrder: ['user', 'params'], status: 204,
  }, async ({ params, user }) => { await moderators.revoke(params.userId!, user?.id ?? null); });

  // ---- PushBroadcastController
  r.post('/v1/staff/push/broadcast', {
    tags: staffTags,
    summary: 'Queue a push notification to every registered device (202; delivery is asynchronous and a no-op when FCM is not configured). data: optional string map, conventionally {type, id} for deep links',
    body: PushBroadcastRequest, currentUser: true, argOrder: ['user', 'body'], status: 202,
  }, ({ body, user }) => { broadcasts.broadcast(body.title!, body.body!, body.data, user?.id ?? null); });

  // ---- StaffRosterController (public reads)
  const rosterTags = ['Staff Roster'];
  r.get('/v1/staff-departments', { tags: rosterTags }, () => roster.listDepartments());
  r.put('/v1/staff-departments/{slug}', { tags: rosterTags, params: { slug: param.string() }, body: UpdateStaffDepartmentRequest },
    ({ params, body }) => roster.updateDepartment(params.slug!, body));
  r.get('/v1/staff-members/years', { tags: rosterTags }, async () => {
    const years = await roster.listYears();
    // No members yet: the current year (Year.now(), JVM zone) so the SPA has a tab.
    return years.length === 0 ? [Number(new Intl.DateTimeFormat('en-US', { timeZone: deps.config.server.timeZone, year: 'numeric' }).format(new Date(systemNowMicros() / 1000)))] : years;
  });
  r.get('/v1/staff-members', { tags: rosterTags, query: { year: param.int({ primitive: true }) } }, ({ query }) => roster.listMembers(query.year!));
  r.post('/v1/staff-members', { tags: rosterTags, body: CreateStaffMemberRequest, status: 201 }, ({ body }) => roster.createMember(body));
  r.put('/v1/staff-members/{id}', { tags: rosterTags, params: { id: param.uuid() }, body: UpdateStaffMemberRequest },
    ({ params, body }) => roster.updateMember(params.id!, body));
  r.delete('/v1/staff-members/{id}', { tags: rosterTags, params: { id: param.uuid() }, status: 204 },
    async ({ params }) => { await roster.deleteMember(params.id!); });

  // ---- BenefitController
  const benefitTags = ['Benefits'];
  r.get('/v1/benefits', { tags: benefitTags }, () => benefits.list());
  r.post('/v1/benefits/{slug}', { tags: benefitTags, params: { slug: param.string() }, body: UpdateBenefitRequest, status: 201 },
    ({ params, body }) => benefits.create(params.slug!, body));
  r.put('/v1/benefits/{slug}', { tags: benefitTags, params: { slug: param.string() }, body: UpdateBenefitRequest },
    ({ params, body }) => benefits.update(params.slug!, body));
  r.delete('/v1/benefits/{slug}', { tags: benefitTags, params: { slug: param.string() }, status: 204 },
    async ({ params }) => { await benefits.delete(params.slug!); });

  // ---- BenefitCardController
  const cardTags = ['Benefit Cards'];
  r.get('/v1/benefit-cards', { tags: cardTags }, () => cards.list());
  r.post('/v1/benefit-cards', { tags: cardTags, body: CreateBenefitCardRequest, status: 201 }, ({ body }) => cards.create(body));
  r.put('/v1/benefit-cards/{id}', { tags: cardTags, params: { id: param.uuid() }, body: UpdateBenefitCardRequest },
    ({ params, body }) => cards.update(params.id!, body));
  r.delete('/v1/benefit-cards/{id}', { tags: cardTags, params: { id: param.uuid() }, status: 204 },
    async ({ params }) => { await cards.delete(params.id!); });
});
