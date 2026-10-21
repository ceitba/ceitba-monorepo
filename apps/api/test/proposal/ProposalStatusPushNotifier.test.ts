// Port of apps/api/src/test/java/org/ceitba/api/service/proposal/ProposalStatusPushNotifierTest.java.
// The mocked ProposalRepository.findById is the `findTitle` lookup; the
// published PushToUsers is the returned trigger.
import { describe, expect, test } from 'bun:test';
import { PROPOSAL_LIFECYCLES, PROPOSAL_STATUSES } from '../../src/features/proposal/dto';
import { statusPushTrigger, titleFor } from '../../src/features/proposal/events';

describe('ProposalStatusPushNotifierTest', () => {
  test('everyStatusAModeratorCanSetHasATitle', () => {
    for (const s of PROPOSAL_STATUSES.filter((x) => x !== 'PENDING')) expect(titleFor(s)?.trim()).toBeTruthy();
    for (const l of PROPOSAL_LIFECYCLES) expect(titleFor(l)?.trim()).toBeTruthy();
    expect(titleFor('PENDING')).toBeNull();
    expect(titleFor(null)).toBeNull();
  });

  test('publishesAPushToUsersTriggerForTheAuthor', async () => {
    const id = crypto.randomUUID();
    const author = crypto.randomUUID();
    const t = await statusPushTrigger({ proposalId: id, authorId: author, newStatus: 'APPROVED' }, (pid) => (pid === id ? 'Más microondas' : null));
    expect(t).not.toBeNull();
    expect(t!.kind).toBe('users');
    if (t!.kind !== 'users') return;
    expect(t!.userIds).toEqual([author]);
    expect(t!.message.title).toBe('Tu propuesta fue aprobada');
    expect(t!.message.body).toBe('Más microondas');
    expect(t!.message.data).toMatchObject({ type: 'proposal', id });
  });

  test('noAuthorOrUnknownStatusOrMissingProposalPublishesNothing', async () => {
    const id = crypto.randomUUID();
    let lookups = 0;
    const lookup = () => { lookups++; return null; };
    expect(await statusPushTrigger({ proposalId: id, authorId: null, newStatus: 'APPROVED' }, lookup)).toBeNull();
    expect(await statusPushTrigger({ proposalId: id, authorId: crypto.randomUUID(), newStatus: 'SOMETHING_ELSE' }, lookup)).toBeNull();
    expect(lookups).toBe(0); // verifyNoInteractions(proposals)

    expect(await statusPushTrigger({ proposalId: id, authorId: crypto.randomUUID(), newStatus: 'CERRADO' }, lookup)).toBeNull();
    expect(lookups).toBe(1);
  });
});
