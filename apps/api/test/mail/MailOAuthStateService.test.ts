// Port of apps/api/src/test/java/org/ceitba/api/service/mail/MailOAuthStateServiceTest.java
// (+ `interop:` verifying a state issued by the Java class).
import { describe, expect, test } from 'bun:test';
import { MAIL_OAUTH_STATE_TTL_MS, MailOAuthStateService } from '../../src/features/mail/logic/mailOAuthState';
import { INTEROP } from '../interop/java-golden';
import { MutableClock } from './support/MutableClock';
import { TEST_JWT_SECRET } from '../../contract/support/env';

const SECRET = TEST_JWT_SECRET;

describe('MailOAuthStateServiceTest', () => {
  test('stateBindsTheStaffUserAndExpires', () => {
    const clock = new MutableClock('2026-10-04T12:00:00Z');
    const states = new MailOAuthStateService(SECRET, clock);
    const staff = crypto.randomUUID();
    const state = states.issue(staff);
    expect(states.verify(state)).toBe(staff);
    clock.advance(MAIL_OAUTH_STATE_TTL_MS - 1000);
    expect(states.verify(state)).toBe(staff);
    clock.advance(2000);
    expect(states.verify(state)).toBeNull();
  });

  test('forgedTamperedOrForeignStatesAreRejected', () => {
    const clock = new MutableClock('2026-10-04T12:00:00Z');
    const states = new MailOAuthStateService(SECRET, clock);
    const staff = crypto.randomUUID();
    const state = states.issue(staff);
    const payload = Buffer.from(state.slice(0, state.indexOf('.')), 'base64url').toString('utf8');
    const forged = Buffer.from(payload.replace(staff, crypto.randomUUID())).toString('base64url') + state.slice(state.indexOf('.'));
    expect(states.verify(forged)).toBeNull();
    expect(states.verify(null)).toBeNull();
    expect(states.verify('garbage')).toBeNull();
    expect(states.verify('a.b')).toBeNull();
    // Signed with another secret.
    const other = new MailOAuthStateService('b3RoZXItand0LXNlY3JldC1rZXktMzJieXRlcy1sb25n', clock);
    expect(other.verify(state)).toBeNull();
  });
});

describe('interop: MailOAuthStateService against Java', () => {
  test('verifies states issued by Java (with and without an org) and rejects them once expired', () => {
    const g = INTEROP.oauthState;
    const clock = new MutableClock(g.now);
    const states = new MailOAuthStateService(SECRET, clock);
    expect(states.verifyState(g.state)).toEqual({ userId: g.userId, orgSlug: null });
    expect(states.verifyState(g.orgState)).toEqual({ userId: g.userId, orgSlug: g.orgSlug });
    clock.advance(MAIL_OAUTH_STATE_TTL_MS + 1000);
    expect(states.verifyState(g.state)).toBeNull();
  });
});
