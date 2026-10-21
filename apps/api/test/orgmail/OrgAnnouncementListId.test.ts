// Port of apps/api/src/test/java/org/ceitba/api/service/orgmail/OrgAnnouncementListIdTest.java
import { describe, expect, test } from 'bun:test';
import { listIdPhrase } from '../../src/features/orgmail/logic/orgAnnouncementListId';
import { INTEROP } from '../interop/java-golden';

describe('OrgAnnouncementListIdTest', () => {
  test('plainAsciiNameIsKept', () => {
    expect(listIdPhrase('SABF', 'sabf')).toBe('SABF');
  });

  test('lineBreaksCannotStartAnotherHeader', () => {
    const phrase = listIdPhrase('Club\r\nBcc: someone@gmail.com', 'club');
    expect(phrase).not.toContain('\r');
    expect(phrase).not.toContain('\n');
    expect(phrase).toBe('Club Bcc: someone@gmail.com');
  });

  test('nonAsciiNameIsAnEncodedWord', () => {
    const phrase = listIdPhrase('Club de Robótica', 'robotica');
    expect(phrase.startsWith('=?UTF-8?Q?')).toBe(true);
    expect(phrase).toMatch(/^[\x20-\x7E]+$/);
  });

  test('blankNameFallsBackToTheSlug', () => {
    expect(listIdPhrase(' <"> ', 'sabf')).toBe('sabf');
    expect(listIdPhrase(null, 'sabf')).toBe('sabf');
  });
});

describe('interop: listIdPhrase against Java', () => {
  test('same phrase for a matrix of names', () => {
    for (const [name, slug, phrase] of INTEROP.listIdPhrase ?? []) expect(listIdPhrase(name, slug)).toBe(phrase);
  });
});
