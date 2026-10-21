// Intentional hardening vs the Java app (contract/COMPATIBILITY.md "Allowlist"): a JWT whose email is no longer
// allowlisted carries no identity on a public (GET permitAll) route either. Java checked the allowlist only in the
// URL rules, so a de-allowlisted STAFF member or org admin kept the role-gated reads under /v1/organizations/**,
// /v1/articles/**, /v1/news/events/** (members, followers, attendees, drafts) until the token expired. TS-only.
import { beforeEach, describe, expect, test } from 'bun:test';
import { seedStaff, seedUser, TARGET, useServer } from '../support';
import { as, seedArticle, seedMembership, seedOrg, wipeNews } from '../../test/news/support/fixtures';

const api = useServer();
const OUTSIDER = 'boss@gmail.com';  // not in AUTH_ALLOWED_DOMAINS / AUTH_ALLOWED_EMAILS
const INSIDER = 'boss@itba.edu.ar';

describe.skipIf(TARGET === 'java')('AllowlistOnPublicReads (TS hardening)', () => {
  beforeEach(async () => {
    await wipeNews(api.db);
    await seedOrg(api.db, 'it', 'IT', 'IT Branch');
    await seedArticle(api.db, { id: 'draft-1', title: 'Draft', excerpt: 'e', body: ['b'], category: 'news', authors: ['a'], status: 'draft', organization: 'it' });
  });

  test('aDeAllowlistedStaffMemberLosesTheStaffReads', async () => {
    await seedUser(api.db, OUTSIDER, { name: 'Out' });
    await seedStaff(api.db, OUTSIDER);
    await seedUser(api.db, INSIDER, { name: 'In' });
    await seedStaff(api.db, INSIDER);
    const outsider = await as(OUTSIDER);
    const insider = await as(INSIDER);
    expect((await api.get('/v1/organizations/it/members', { as: insider })).status).toBe(200);
    const denied = await api.get('/v1/organizations/it/members', { as: outsider });
    expect(denied.status).toBe(403);
    expect(denied.json.error).toBe('AccessDenied');
    expect((await api.get('/v1/organizations/it/followers', { as: outsider })).status).toBe(403);
    expect((await api.get('/v1/articles/draft-1', { as: insider })).status).toBe(200);
    expect((await api.get('/v1/articles/draft-1', { as: outsider })).status).toBe(404);
    // The public data itself stays readable.
    expect((await api.get('/v1/organizations/it', { as: outsider })).status).toBe(200);
  });

  test('aDeAllowlistedOrgAdminLosesTheAdminReads', async () => {
    const id = await seedUser(api.db, OUTSIDER, { name: 'Out' });
    await seedMembership(api.db, id, 'it', 'admin');
    const outsider = await as(OUTSIDER);
    expect((await api.get('/v1/organizations/it/members', { as: outsider })).status).toBe(403);
    expect((await api.get('/v1/articles/draft-1', { as: outsider })).status).toBe(404);
  });
});
