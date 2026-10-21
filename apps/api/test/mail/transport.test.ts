// config/MailConfig transport selection and its startup failures, and the
// strict InternetAddress check behind MAIL_FROM and SMTP recipients.
import { describe, expect, test } from 'bun:test';
import { CONTRACT_ENV } from '../../contract/support/env';
import { loadConfig } from '../../src/config';
import { parseStrictAddress } from '../../src/features/mail/logic/internetAddress';
import { createMailTransport, DisabledEmailSender, GmailApiTransportSlot, LoggingEmailSender, SmtpEmailSender } from '../../src/infra/mail';
import { silentLogger } from '../../src/infra/logger';

const transport = async (env: Record<string, string>) =>
  createMailTransport(await loadConfig({ ...CONTRACT_ENV, DATABASE_URL: 'jdbc:postgresql://localhost:1/x', MAIL_LOG_SENDS: 'false', ...env }), silentLogger);

describe('MailConfig.transport', () => {
  test('disabledUnlessMailEnabled', async () => {
    expect(await transport({})).toBeInstanceOf(DisabledEmailSender);
    expect(await transport({ MAIL_LOG_SENDS: 'true' })).toBeInstanceOf(LoggingEmailSender);
  });

  test('gmailApiIsTheDefaultAndLeftToTheMailFeature', async () => {
    const t = await transport({ MAIL_ENABLED: 'true' });
    expect(t).toBeInstanceOf(GmailApiTransportSlot);
    expect((t as GmailApiTransportSlot).from).toBe('CEITBA <ceitba@itba.edu.ar>');
    expect(await transport({ MAIL_ENABLED: 'true', MAIL_TRANSPORT: ' Gmail-API ' })).toBeInstanceOf(GmailApiTransportSlot);
  });

  test('smtpNeedsHostUsernameAndPassword', async () => {
    await expect(transport({ MAIL_ENABLED: 'true', MAIL_TRANSPORT: 'smtp' })).rejects.toThrow('MAIL_ENABLED=true needs MAIL_USERNAME and MAIL_PASSWORD');
    await expect(transport({ MAIL_ENABLED: 'true', MAIL_TRANSPORT: 'smtp', MAIL_USERNAME: 'u', MAIL_PASSWORD: ' ' })).rejects.toThrow('MAIL_USERNAME and MAIL_PASSWORD');
    await expect(transport({ MAIL_ENABLED: 'true', MAIL_TRANSPORT: 'smtp', MAIL_HOST: '', MAIL_USERNAME: 'u', MAIL_PASSWORD: 'p' })).rejects.toThrow('spring.mail.host (MAIL_HOST) is not set');
    expect(await transport({ MAIL_ENABLED: 'true', MAIL_TRANSPORT: 'SMTP', MAIL_USERNAME: 'u', MAIL_PASSWORD: 'p' })).toBeInstanceOf(SmtpEmailSender);
  });

  test('logTransportIsDevOnly', async () => {
    await expect(transport({ MAIL_ENABLED: 'true', MAIL_TRANSPORT: 'log' })).rejects.toThrow('MAIL_TRANSPORT=log is dev-only and needs MAIL_LOG_SENDS=true');
    expect(await transport({ MAIL_ENABLED: 'true', MAIL_TRANSPORT: 'log', MAIL_LOG_SENDS: 'true' })).toBeInstanceOf(LoggingEmailSender);
  });

  test('anUnknownTransportOrAnInvalidFromFailsTheStartup', async () => {
    await expect(transport({ MAIL_TRANSPORT: 'sendgrid' })).rejects.toThrow('MAIL_TRANSPORT must be gmail-api, smtp or log, not: sendgrid');
    await expect(transport({ MAIL_FROM: 'CEITBA ceitba at itba' })).rejects.toThrow('mail.from (MAIL_FROM) is not a valid address: CEITBA ceitba at itba');
  });

  test('smtpRefusesAnInvalidRecipientAsRECIPIENT', async () => {
    const t = await transport({ MAIL_ENABLED: 'true', MAIL_TRANSPORT: 'smtp', MAIL_USERNAME: 'u', MAIL_PASSWORD: 'p' });
    await expect(t.send({ to: 'not an address', subject: 's', html: 'h', text: 't' })).rejects.toMatchObject({ kind: 'RECIPIENT' });
  });
});

describe('InternetAddress(strict)', () => {
  test('acceptsNamedQuotedAndBareAddresses', () => {
    expect(parseStrictAddress('CEITBA <ceitba@itba.edu.ar>')).toBe('ceitba@itba.edu.ar');
    expect(parseStrictAddress('"CEITBA, centro" <ceitba@itba.edu.ar>')).toBe('ceitba@itba.edu.ar');
    expect(parseStrictAddress('alice@itba.edu.ar')).toBe('alice@itba.edu.ar');
    expect(parseStrictAddress('root@localhost')).toBe('root@localhost');
  });

  test('rejectsWhatStrictParsingRejects', () => {
    for (const bad of ['', 'alice', '@itba.edu.ar', 'alice@', 'a b@itba.edu.ar', 'alice@itba..edu.ar', 'alice@.itba.edu.ar', 'Name <alice>', 'a(b)@x.y']) {
      expect(() => parseStrictAddress(bad)).toThrow();
    }
  });
});
