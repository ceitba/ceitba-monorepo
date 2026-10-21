// Port of apps/api/src/test/java/org/ceitba/api/service/mail/GmailApiEmailSenderTest.java
// (the MIME structure check parses with a small RFC 822 reader instead of
// Jakarta Mail; `interop:` has Jakarta parse a raw built here).
import { describe, expect, test } from 'bun:test';
import { classify, DEFAULT_RATE_BACKOFF_MS, GmailApiEmailSender } from '../../src/features/mail/logic/gmailApiEmailSender';
import type { OutgoingEmail } from '../../src/infra/mail';
import { parseMime } from './support/mimeReader';
import { INTEROP } from '../interop/java-golden';

const sender = new GmailApiEmailSender(null, null, 'CEITBA <ceitba@itba.edu.ar>');

const err = (reason: string, message: string, status: string) =>
  `{"error":{"message":"${message}"${reason === '' ? '' : `,"errors":[{"reason":"${reason}"}]`}${status === '' ? '' : `,"status":"${status}"`}}}`;
const kind = (status: number, body: string) => classify(status, body).exception.kind;

const SAMPLE: OutgoingEmail = {
  to: 'ana@itba.edu.ar', subject: 'La semana en ITBA: café ñandú 🎓', html: '<p>Hola ñ</p>', text: 'Hola ñ',
  headers: {
    'List-Unsubscribe': '<https://ceitba.org.ar/api/v1/digests/unsubscribe?token=t>',
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    'List-Id': 'La semana en ITBA <digest.ceitba.itba.edu.ar>',
    Precedence: 'bulk',
  },
  kind: 'digest',
};

describe('GmailApiEmailSenderTest', () => {
  test('rawIsBase64UrlMimeWithHeadersUtf8SubjectAndBothBodies', async () => {
    const raw = await sender.raw(SAMPLE);

    expect(/[+/=]/.test(raw)).toBe(false); // base64url, unpadded
    const msg = parseMime(Buffer.from(raw, 'base64url'));
    expect(msg.subject).toBe('La semana en ITBA: café ñandú 🎓');
    expect(msg.header('From')).toContain('ceitba@itba.edu.ar');
    expect(msg.header('To')).toBe('ana@itba.edu.ar');
    expect(msg.header('List-Unsubscribe')!.startsWith('<https://ceitba.org.ar/api/v1/digests/unsubscribe')).toBe(true);
    expect(msg.header('List-Unsubscribe-Post')).toBe('List-Unsubscribe=One-Click');
    expect(msg.header('List-Id')).toContain('digest.ceitba.itba.edu.ar');
    expect(msg.header('Precedence')).toBe('bulk');
    expect(msg.header('Message-ID')!.endsWith('@itba.edu.ar>')).toBe(true);
    const leaves = msg.leaves().map((l) => `${l.contentType}|${l.body}`).join('\n');
    expect(leaves).toContain('text/plain');
    expect(leaves).toContain('text/html');
    expect(leaves).toContain('Hola ñ');
  });

  test('onlyTheDailyLimitIsQuotaAndPausesTheAccount', () => {
    expect(kind(403, err('dailyLimitExceeded', 'Daily Limit Exceeded', ''))).toBe('QUOTA');
    expect(kind(429, err('', 'Daily user sending quota exceeded', 'RESOURCE_EXHAUSTED'))).toBe('QUOTA');
  });

  test('perSecondThrottlingIsTransportWithAShortBackoffHonouringRetryAfter', () => {
    for (const [status, body] of [[429, '{}'], [403, err('rateLimitExceeded', 'Rate Limit Exceeded', '')],
      [403, err('userRateLimitExceeded', 'User-rate limit exceeded', '')],
      [429, err('', 'Too many requests', 'RESOURCE_EXHAUSTED')]] as [number, string][]) {
      const e = classify(status, body).exception;
      expect(e.kind).toBe('TRANSPORT');
      expect(e.retryAfterMs).toBe(DEFAULT_RATE_BACKOFF_MS);
    }
    const hinted = classify(429, '{}', '7').exception;
    expect(hinted.retryAfterMs).toBe(7000);
    // Absurd hints are capped; the pause itself is capped again by MailSendService.
    expect(classify(429, '{}', '86400').exception.retryAfterMs).toBe(10 * 60_000);
  });

  test('authErrorsAreTransportAndFlagTheConnectionAsBroken', () => {
    const unauthorized = classify(401, '{"error":{"status":"UNAUTHENTICATED"}}');
    expect(unauthorized.exception.kind).toBe('TRANSPORT');
    expect(unauthorized.authProblem).toBe(true);
    const forbidden = classify(403, err('insufficientPermissions', 'Insufficient Permission', ''));
    expect(forbidden.exception.kind).toBe('TRANSPORT');
    expect(forbidden.exception.retryAfterMs).toBeUndefined();
    expect(forbidden.authProblem).toBe(true);
  });

  test('serverErrorsAreTransportBadRecipientIsRecipientOtherClientErrorsAreTransient', () => {
    expect(kind(500, '')).toBe('TRANSPORT');
    expect(kind(503, 'not json')).toBe('TRANSPORT');
    expect(classify(503, '').authProblem).toBe(false);
    expect(kind(400, err('invalidArgument', 'Invalid To header', ''))).toBe('RECIPIENT');
    expect(kind(400, err('invalidArgument', 'Recipient address required', ''))).toBe('RECIPIENT');
    // Other per-message 4xx: retried a few times, the account is not paused.
    expect(kind(400, err('invalidArgument', 'Invalid value for ByteString', ''))).toBe('TRANSIENT');
    expect(kind(404, '')).toBe('TRANSIENT');
    expect(kind(413, '')).toBe('TRANSIENT');
  });
});


describe('interop: GmailApiEmailSender.classify against Java', () => {
  test('same kind, message, retry-after and auth flag for a matrix of responses', () => {
    for (const [status, body, retryAfter, k, message, retryMs, auth] of INTEROP.gmailClassify) {
      const c = classify(status, body, retryAfter);
      expect([c.exception.kind, c.exception.message, c.exception.retryAfterMs ?? null, c.authProblem]).toEqual([k, message, retryMs, auth]);
    }
  });
});
