// Google Workspace directory lookups for subject reviews
// (docs/SUBJECT-REVIEWS.md "Professors"): who an @itba.edu.ar address
// belongs to. People API people:searchDirectoryPeople with the CEITBA sender
// account's access token (directory.readonly scope, apps/api/docs/WEEKLY-DIGEST.md
// "Sender accounts"); the fake answers from a fixed list for dev and tests.

export const SCOPE_DIRECTORY = 'https://www.googleapis.com/auth/directory.readonly';
const SEARCH_ENDPOINT = 'https://people.googleapis.com/v1/people:searchDirectoryPeople';

export interface DirectoryPerson { email: string; name: string }

export class DirectoryUnavailableError extends Error {}

export interface ProfessorDirectory {
  /** The person with exactly this (lowercase) address, or null. Throws DirectoryUnavailableError when it cannot ask. */
  findByEmail(email: string): Promise<DirectoryPerson | null>;
}

interface PeopleSearchResponse {
  people?: { names?: { displayName?: string; metadata?: { primary?: boolean } }[]; emailAddresses?: { value?: string }[] }[];
}

export class GooglePeopleDirectory implements ProfessorDirectory {
  /** accessToken: a token with SCOPE_DIRECTORY, or null when no account can provide one. */
  constructor(private readonly accessToken: () => Promise<string | null>, private readonly http: typeof fetch = globalThis.fetch) {}

  async findByEmail(email: string): Promise<DirectoryPerson | null> {
    const token = await this.accessToken();
    if (token == null) throw new DirectoryUnavailableError('No sender account with the directory scope');
    const url = `${SEARCH_ENDPOINT}?${new URLSearchParams({
      query: email, readMask: 'names,emailAddresses', sources: 'DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE', pageSize: '5',
    })}`;
    let res: Response;
    try {
      res = await this.http(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
    } catch {
      throw new DirectoryUnavailableError('People API unreachable');
    }
    if (!res.ok) {
      await res.arrayBuffer().catch(() => undefined);
      throw new DirectoryUnavailableError(`People API HTTP ${res.status}`);
    }
    const body = (await res.json().catch(() => ({}))) as PeopleSearchResponse;
    // The search is fuzzy: keep only the person whose address is exactly this one.
    for (const p of body.people ?? []) {
      if (!(p.emailAddresses ?? []).some((e) => e.value?.toLowerCase() === email)) continue;
      const names = p.names ?? [];
      const name = (names.find((n) => n.metadata?.primary) ?? names[0])?.displayName?.trim();
      if (name) return { email, name };
    }
    return null;
  }
}

/** REVIEWS_DIRECTORY_USE_FAKE=true: a fixed directory (also what the dev seed and the contract tests use). */
export class FakeProfessorDirectory implements ProfessorDirectory {
  static readonly PEOPLE: DirectoryPerson[] = [
    { email: 'mgarcia@itba.edu.ar', name: 'María García' },
    { email: 'jlopez@itba.edu.ar', name: 'Jorge López' },
    { email: 'sfernandez@itba.edu.ar', name: 'Sofía Fernández' },
    { email: 'rquiroga@itba.edu.ar', name: 'Ramiro Quiroga' },
    { email: 'lbenitez@itba.edu.ar', name: 'Laura Benítez' },
  ];

  async findByEmail(email: string): Promise<DirectoryPerson | null> {
    return FakeProfessorDirectory.PEOPLE.find((p) => p.email === email) ?? null;
  }
}
