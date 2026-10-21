// Port of apps/api/src/test/java/org/ceitba/api/service/mail/SmtpReplyClassificationTest.java
// Who an SMTP reply blames decides whether one bad recipient fails alone
// (RECIPIENT), is retried a few times (TRANSIENT) or pauses the whole batch (TRANSPORT).
import { describe, expect, test } from 'bun:test';
import type { EmailSendKind } from '../../src/infra/mail';
import { classifyReply, classifySmtpFailure } from '../../src/features/mail/logic/smtpReplyClassification';
import { INTEROP } from '../interop/java-golden';

const CASES: [string, EmailSendKind][] = [
  ['452 4.2.2 The email account that you tried to reach is over quota', 'RECIPIENT'],
  ['550 5.1.1 The email account that you tried to reach does not exist', 'RECIPIENT'],
  ['552 5.2.2 Mailbox size limit exceeded', 'RECIPIENT'],
  ['451 4.1.1 bad destination mailbox', 'RECIPIENT'],
  ['550-5.4.5 Daily user sending limit exceeded. For more information on Gmail sending limits', 'QUOTA'],
  ['421 4.7.0 Try again later, closing connection', 'TRANSPORT'],
  ['454 4.7.0 Too many login attempts, please try again later', 'TRANSPORT'],
  ['535 5.7.8 Username and Password not accepted', 'TRANSPORT'],
  ['451 4.3.0 Mail system temporarily unavailable', 'TRANSIENT'],
  ['452 4.5.3 Too many recipients', 'TRANSIENT'],
];

describe('SmtpReplyClassificationTest', () => {
  CASES.forEach(([reply, expected], i) => {
    test(`classifiesTheReplyByItsEnhancedStatusCode [${i + 1}] ${reply}, ${expected}`, () => {
      expect(classifyReply(reply)).toBe(expected);
    });
  });

  test('replyWithoutCodeFallsBackToTheWording', () => {
    expect(classifyReply('Daily limit exceeded')).toBe('TRANSPORT');
    expect(classifyReply('Daily user sending limit exceeded')).toBe('QUOTA');
    expect(classifyReply('connection reset')).toBeNull();
    // A permanent reply that blames nobody in particular is left to the caller.
    expect(classifyReply('550 5.7.1 message rejected')).toBeNull();
  });

  test('wrapsByExceptionTypeAndUnknownErrorsAreTheTransports', () => {
    // new MailAuthenticationException("bad")
    expect(classifySmtpFailure({ type: 'auth', message: 'bad', messages: ['bad'], invalidRecipients: false }).kind).toBe('TRANSPORT');
    // new MailSendException("Mail server connection failed")
    expect(classifySmtpFailure({ type: 'send', message: 'Mail server connection failed', messages: ['Mail server connection failed'],
      invalidRecipients: false }).kind).toBe('TRANSPORT');
    // new MailSendException("550 5.1.1 no such user")
    expect(classifySmtpFailure({ type: 'send', message: '550 5.1.1 no such user', messages: ['550 5.1.1 no such user'],
      invalidRecipients: false }).kind).toBe('RECIPIENT');
  });
});


describe('interop: SmtpEmailSender.classifyReply against Java', () => {
  test('same kind for a matrix of replies', () => {
    for (const [reply, kind] of INTEROP.smtpReplies) expect(classifyReply(reply)).toBe(kind);
  });
});
