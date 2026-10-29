// GooglePeopleDirectory (src/external/googleDirectory.ts): the People API
// search is fuzzy, so only the person with exactly that address counts.
import { describe, expect, test } from 'bun:test';
import { DirectoryUnavailableError, GooglePeopleDirectory } from '../../src/external/googleDirectory';
import { currentTerm } from '../../src/features/review/service';

const respond = (status: number, body: unknown, seen: string[] = []) =>
  (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push(`${String(url)} ${(init?.headers as Record<string, string>).Authorization}`);
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;

describe('GooglePeopleDirectory', () => {
  test('returnsThePrimaryNameOfTheExactAddress', async () => {
    const seen: string[] = [];
    const dir = new GooglePeopleDirectory(async () => 'tok', respond(200, { people: [
      { names: [{ displayName: 'María Garciarena' }], emailAddresses: [{ value: 'mgarciarena@itba.edu.ar' }] },
      { names: [{ displayName: 'M. García' }, { displayName: 'María García', metadata: { primary: true } }], emailAddresses: [{ value: 'MGarcia@itba.edu.ar' }] },
    ] }, seen));
    expect(await dir.findByEmail('mgarcia@itba.edu.ar')).toEqual({ email: 'mgarcia@itba.edu.ar', name: 'María García' });
    expect(seen[0]).toContain('people:searchDirectoryPeople?query=mgarcia%40itba.edu.ar');
    expect(seen[0]).toContain('sources=DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE');
    expect(seen[0]).toEndWith('Bearer tok');
  });

  test('nullWhenNobodyHasExactlyThatAddress', async () => {
    const dir = new GooglePeopleDirectory(async () => 'tok', respond(200, { people: [{ names: [{ displayName: 'X' }], emailAddresses: [{ value: 'other@itba.edu.ar' }] }] }));
    expect(await dir.findByEmail('mgarcia@itba.edu.ar')).toBeNull();
    expect(await new GooglePeopleDirectory(async () => 'tok', respond(200, {})).findByEmail('a@itba.edu.ar')).toBeNull();
  });

  test('unavailableWithoutATokenOrOnAnHttpError', async () => {
    await expect(new GooglePeopleDirectory(async () => null, respond(200, {})).findByEmail('a@itba.edu.ar')).rejects.toBeInstanceOf(DirectoryUnavailableError);
    await expect(new GooglePeopleDirectory(async () => 'tok', respond(403, { error: {} })).findByEmail('a@itba.edu.ar')).rejects.toBeInstanceOf(DirectoryUnavailableError);
  });
});

describe('currentTerm', () => {
  test('firstSemesterThroughJuly', () => {
    expect(currentTerm('2026-03-01')).toEqual({ year: 2026, period: 1 });
    expect(currentTerm('2026-07-31')).toEqual({ year: 2026, period: 1 });
    expect(currentTerm('2026-08-01')).toEqual({ year: 2026, period: 2 });
  });
});
