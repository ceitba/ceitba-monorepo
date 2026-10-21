// Port of apps/api/src/test/java/org/ceitba/api/service/push/FakePushGateway.java:
// records every call (also the ones told to fail) and answers SENT unless a
// token was given another outcome. (src/infra/push.ts's FakePushGateway does not
// record failed calls, which FcmPushNotificationServiceTest counts.)
import { PushDeliveryError, type PushGateway, type PushMessage, type PushOutcome } from '../../../src/infra/push';

export class FakePushGateway implements PushGateway {
  private readonly recorded: { tokens: string[]; message: PushMessage }[] = [];
  private readonly outcomes = new Map<string, PushOutcome>();
  private readonly failing = new Set<number>();

  async send(tokens: string[], message: PushMessage): Promise<PushOutcome[]> {
    const index = this.recorded.length;
    this.recorded.push({ tokens: [...tokens], message });
    if (this.failing.has(index)) throw new PushDeliveryError('simulated failure');
    return tokens.map((t) => this.outcomes.get(t) ?? 'SENT');
  }

  answer(token: string, outcome: PushOutcome): this {
    this.outcomes.set(token, outcome);
    return this;
  }

  failCall(zeroBasedIndex: number): this {
    this.failing.add(zeroBasedIndex);
    return this;
  }

  calls() {
    return [...this.recorded];
  }

  allTokens(): string[] {
    return this.recorded.flatMap((c) => c.tokens);
  }

  reset(): void {
    this.recorded.length = 0;
    this.outcomes.clear();
    this.failing.clear();
  }
}
