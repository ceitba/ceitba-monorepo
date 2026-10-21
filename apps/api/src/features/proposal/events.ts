// service/proposal/ProposalStatusChangedEvent + ProposalStatusPushNotifier.
//
// ProposalModerationService publishes the event inside the moderating
// transaction (ApplicationEventPublisher.publishEvent: synchronous). The
// listeners registered here (tests: = @RecordApplicationEvents) see every
// published event; the notifier turns it into a PushToUsers trigger that the
// service fires only after commit (PushTriggerListener, AFTER_COMMIT + async),
// so a rolled-back moderation sends nothing.
//
// newStatus is either a ProposalStatus name (APPROVED, REJECTED) or a
// ProposalLifecycle name (ABIERTO, ACEPTADO, CERRADO). authorId is null when
// the author deleted their account.

import { forResource, type PushTrigger } from '../news/pushTriggers';

export interface ProposalStatusChangedEvent {
  proposalId: string;
  authorId: string | null;
  newStatus: string;
}

type Listener = (e: ProposalStatusChangedEvent) => void;
const listeners = new Set<Listener>();

/** Subscribes to every published event; returns the unsubscribe function. */
export function onProposalStatusChanged(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function publishStatusChanged(e: ProposalStatusChangedEvent): void {
  for (const l of listeners) l(e);
}

/** ProposalStatusPushNotifier.PUSH_TYPE */
export const PUSH_TYPE = 'proposal';

/** ProposalStatusPushNotifier.titleFor */
export function titleFor(newStatus: string | null | undefined): string | null {
  switch (newStatus) {
    case 'APPROVED': return 'Tu propuesta fue aprobada';
    case 'REJECTED': return 'Tu propuesta fue rechazada';
    case 'ACEPTADO': return 'Tu propuesta fue aceptada';
    case 'CERRADO': return 'Tu propuesta fue cerrada';
    case 'ABIERTO': return 'Tu propuesta volvió a estar abierta';
    default: return null;
  }
}

/**
 * ProposalStatusPushNotifier.on: the PushToUsers trigger for the author, or
 * null (no author, a status without a title, or the proposal is gone).
 * `findTitle` is proposals.findById(..).map(getTitle): in Java a persistence-
 * context hit on the locked row.
 */
export async function statusPushTrigger(
  e: ProposalStatusChangedEvent,
  findTitle: (proposalId: string) => Promise<string | null> | string | null,
): Promise<PushTrigger | null> {
  if (e.authorId === null) return null;
  const title = titleFor(e.newStatus);
  if (title === null) return null;
  const body = await findTitle(e.proposalId);
  if (body === null) return null;
  return { kind: 'users', userIds: [e.authorId], message: forResource(title, body, PUSH_TYPE, e.proposalId) };
}
