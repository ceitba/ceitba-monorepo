// Ports apps/api/src/test/java/org/ceitba/api/service/sync/ProposalFirestoreImporterTest.java:
// the field mapping and row decisions against an in-memory recording repository.
import { beforeEach, describe, expect, test } from 'bun:test';
import { ContentHmac } from '../../src/features/crypto/logic/contentHmac';
import {
  cut, FirestoreImportError, flattenComments, LEGACY_ATTACHMENT_KEY, lifecycle, moderation, nameUuid, proposalId, ProposalFirestoreImporter,
  time, topic, type ImportUsers, type ProposalImportRows,
} from '../../src/features/sync/proposalImporter';

const NOW = Date.parse('2026-01-01T00:00:00Z') * 1000;
const CREATED = Date.parse('2024-05-01T12:00:00Z') * 1000;
const SECRET = 'dGVzdC1qd3Qtc2VjcmV0LWtleS0zMmJ5dGVzLWxvbmch';
const LEGACY_KEY = 'proposals/legacy/0f8e2a4c-1b3d-4e5f-8a7b-9c0d1e2f3a4b.png';
const us = (iso: string) => Date.parse(iso) * 1000;

class RecordingRows implements ProposalImportRows {
  proposalIsNew = true;
  voteIsNew = true;
  existingAliases = new Map<string, Map<string, string>>();
  proposals: { id: string; authorId: string | null; title: string; description: string; topic: string; status: string; lifecycle: string; rejectionReason: string | null; moderatedBy: string | null; createdAt: number }[] = [];
  locked: string[] = [];
  aliasRows: [string, string, string][] = [];
  votes: [string, string, string, number][] = [];
  comments: { id: string; proposalId: string; authorId: string | null; parentId: string | null; body: string | null; at: number }[] = [];
  tombstones: { id: string; parentId: string | null; at: number }[] = [];
  attachments: [string, number, string, string][] = [];
  recomputed: string[] = [];
  existing = new Set<string>();
  async insertProposal(id: string, authorId: string | null, title: string, description: string, topic: string, status: string, lifecycle: string, rejectionReason: string | null, moderatedBy: string | null, createdAt: number) {
    this.proposals.push({ id, authorId, title, description, topic, status, lifecycle, rejectionReason, moderatedBy, createdAt });
    return this.proposalIsNew;
  }
  async proposalExists(id: string) { return this.existing.has(id); }
  async lockProposal(id: string) { this.locked.push(id); }
  async aliases(p: string) { return this.existingAliases.get(p) ?? new Map(); }
  async insertAlias(p: string, u: string, a: string) { this.aliasRows.push([p, u, a]); return true; }
  async insertVote(p: string, u: string, v: string, at: number) { this.votes.push([p, u, v, at]); return this.voteIsNew; }
  async insertComment(id: string, proposalId: string, authorId: string | null, parentId: string | null, body: string, at: number) {
    this.comments.push({ id, proposalId, authorId, parentId, body, at });
    return true;
  }
  async insertDeletedComment(id: string, _p: string, parentId: string | null, at: number) { this.tombstones.push({ id, parentId, at }); return true; }
  async insertAttachment(p: string, pos: number, key: string, type: string) { this.attachments.push([p, pos, key, type]); return true; }
  async recomputeCounters(id: string) { this.recomputed.push(id); }
}

/** Hands out GeneradoUno, GeneradoDos, ... and records what was taken. */
class SequentialAliases {
  takenSeen: Set<string>[] = [];
  private readonly names = ['GeneradoUno', 'GeneradoDos', 'GeneradoTres', 'GeneradoCuatro'];
  next(taken: ReadonlySet<string>): string {
    this.takenSeen.push(new Set(taken));
    return this.names[this.takenSeen.length - 1]!;
  }
}

const author = crypto.randomUUID();
const voter = crypto.randomUUID();
let rows: RecordingRows;
let generator: SequentialAliases;
let importer: ProposalFirestoreImporter;
let warnings: string[];
let deletedUids: Set<string>;

function makeImporter(secret: string) {
  const users: ImportUsers = {
    async findByFirebaseUidIn() { return new Map([['uid-author', author], ['uid-voter', voter]]); },
    async isDeletedFirebaseAccount(uid) { return deletedUids.has(uid); },
  };
  return new ProposalFirestoreImporter(rows, users, generator, () => NOW, ContentHmac.fromJwtSecret(secret));
}

function doc(...kv: unknown[]): Record<string, unknown> {
  const m: Record<string, unknown> = { title: 'Título', authorized: 1, author: 'uid-author', dateTime: '2024-05-01T12:00:00.000Z' };
  for (let i = 0; i < kv.length; i += 2) m[kv[i] as string] = kv[i + 1];
  return m;
}

beforeEach(() => {
  rows = new RecordingRows();
  generator = new SequentialAliases();
  warnings = [];
  deletedUids = new Set();
  importer = makeImporter(SECRET);
});

describe('ProposalFirestoreImporterTest', () => {
  test('proposalOfADeletedAccountIsNotRecreated', async () => {
    deletedUids.add('uid-gone');
    expect(await importer.importProposal('doc-gone', doc('author', 'uid-gone'), warnings)).toBe('SKIPPED');
    expect(rows.proposals).toEqual([]);
    expect(warnings).toContain('author deleted their account; proposal not re-imported');
    expect(warnings).not.toContain('author not imported; proposal kept without author');

    warnings.length = 0;
    rows.existing.add(proposalId('doc-gone'));
    rows.proposalIsNew = false;
    await importer.importProposal('doc-gone', doc('author', 'uid-gone'), warnings);
    expect(rows.proposals.length).toBe(1);
    expect(rows.proposals[0]!.authorId).toBeNull();
    expect(warnings).toContain('author not imported; proposal kept without author');
  });

  test('topicsMatchIgnoringCaseAccentsAndSpaces', () => {
    expect(topic('Vida universitaria', warnings)).toBe('VIDA_UNIVERSITARIA');
    expect(topic(' vída-Universitaria ', warnings)).toBe('VIDA_UNIVERSITARIA');
    expect(topic('CEITBA', warnings)).toBe('CEITBA');
    expect(topic('Eventos', warnings)).toBe('EVENTOS');
    expect(topic('cursos', warnings)).toBe('CURSOS');
    expect(topic('Otros', warnings)).toBe('OTROS');
    expect(warnings).toEqual([]);
    expect(topic('Deportes', warnings)).toBe('OTROS');
    expect(topic(null, warnings)).toBe('OTROS');
    expect(warnings).toEqual(['unknown topic; filed under OTROS', 'missing topic; filed under OTROS']);
  });

  test('authorizedMapsToModerationStatus', () => {
    expect(moderation(0)).toBe('PENDING');
    expect(moderation(1)).toBe('APPROVED');
    expect(moderation(2)).toBe('REJECTED');
    expect(moderation(1.0)).toBe('APPROVED');
    expect(moderation(' 2 ')).toBe('REJECTED');
    for (const bad of [3, -1, 1.5, 'sí', null, true]) {
      expect(() => moderation(bad)).toThrow(new FirestoreImportError('authorized must be 0, 1 or 2'));
    }
  });

  test('statusMapsToLifecycle', () => {
    expect(lifecycle('Abierto', warnings)).toBe('ABIERTO');
    expect(lifecycle('ACEPTADO', warnings)).toBe('ACEPTADO');
    expect(lifecycle('cerrado', warnings)).toBe('CERRADO');
    expect(lifecycle(null, warnings)).toBe('ABIERTO');
    expect(warnings).toEqual([]);
    expect(lifecycle('Rechazado', warnings)).toBe('ABIERTO');
    expect(warnings).toEqual(['unknown status; imported as ABIERTO']);
  });

  test('timesAcceptIsoStringsAndRawTimestamps', () => {
    expect(time('2024-05-01T12:00:00.000Z')).toBe(CREATED);
    expect(time({ _seconds: CREATED / 1e6, _nanoseconds: 0 })).toBe(CREATED);
    expect(time({ seconds: CREATED / 1e6 })).toBe(CREATED);
    expect(time('ayer')).toBeNull();
    expect(time(' ')).toBeNull();
    expect(time(123)).toBeNull();
    expect(time({ x: 1 })).toBeNull();
  });

  test('onlyCopiedLegacyKeysAreAttachmentKeys', () => {
    const p = LEGACY_ATTACHMENT_KEY;
    expect(p.test(LEGACY_KEY)).toBe(true);
    expect(p.test('proposals/legacy/0f8e2a4c-1b3d-4e5f-8a7b-9c0d1e2f3a4b.pdf')).toBe(true);
    expect(p.test('proposals/legacy/0f8e2a4c-1b3d-4e5f-8a7b-9c0d1e2f3a4b.exe')).toBe(false);
    expect(p.test('proposals/0f8e2a4c-1b3d-4e5f-8a7b-9c0d1e2f3a4b-0123456789abcdef.png')).toBe(false);
    expect(p.test('https://firebasestorage.example.test/v0/b/app/o/Propuestas%2F1.jpg')).toBe(false);
    expect(p.test('proposals/legacy/../media/x.png')).toBe(false);
  });

  test('cutNeverSplitsASurrogatePair', () => {
    expect(cut('abc', 5)).toBe('abc');
    expect(cut('ab😀', 3)).toBe('ab');
    expect(cut('abcd', 3)).toBe('abc');
  });

  test('commentsFlattenToOneLevelWithStableKeys', () => {
    const raw = [
      { author: 'a', comment: 'top', dateTime: '2024-05-02T00:00:00Z', replies: [
        { author: 'b', comment: 'r1', dateTime: '2024-05-03T00:00:00Z', replies: [{ author: 'c', comment: 'deep' }] },
        { author: 'b', comment: 'r1 again', dateTime: '2024-05-03T00:00:00Z' }] },
      'not a map',
    ];
    const flat = flattenComments(raw, CREATED);
    expect(flat.map((c) => c.body)).toEqual(['top', 'r1', 'deep', 'r1 again']);
    expect(flat.map((c) => c.parentIndex)).toEqual([null, 0, 0, 0]);
    expect(flat[2]!.at).toBe(CREATED);
    expect(new Set(flat.map((c) => c.key)).size).toBe(flat.length);
    expect(flattenComments(raw, CREATED)).toEqual(flat);
    expect(flattenComments('nope', CREATED)).toEqual([]);
  });

  test('newDocumentIsInsertedWithMappedFieldsAndChildRows', async () => {
    const d = doc('description', 'd', 'topic', 'Eventos', 'status', 'Cerrado', 'mod', 'uid-voter',
      'votes', { 'uid-voter': { like: false, timestamp: '2024-05-02T00:00:00Z' }, 'uid-ghost': { like: true }, 'uid-author': { like: 'maybe' } },
      'comments', [{ author: 'uid-voter', comment: 'hola', dateTime: '2024-05-03T00:00:00Z' }],
      'userNames', { 'uid-author': 'AlfaRojo', 'uid-ghost': 'Fantasma' },
      'filesURL', ['https://img.example.test/o/Propuestas%2F1.jpg', LEGACY_KEY, 'ftp://x/y.jpg', '', 7]);
    expect(await importer.importProposal('doc-1', d, warnings)).toBe('CREATED');
    const id = proposalId('doc-1');
    expect(rows.proposals).toEqual([{ id, authorId: author, title: 'Título', description: 'd', topic: 'EVENTOS', status: 'APPROVED', lifecycle: 'CERRADO',
      rejectionReason: null, moderatedBy: voter, createdAt: CREATED }]);
    expect(rows.locked).toEqual([]);
    expect(rows.aliasRows).toEqual([[id, author, 'AlfaRojo'], [id, voter, 'GeneradoUno']]);
    expect(rows.votes).toEqual([[id, voter, 'DOWN', us('2024-05-02T00:00:00Z')]]);
    expect(rows.comments.length).toBe(1);
    expect(rows.comments[0]).toMatchObject({ proposalId: id, authorId: voter, parentId: null, body: 'hola', at: us('2024-05-03T00:00:00Z') });
    expect(rows.attachments).toEqual([[id, 0, LEGACY_KEY, 'image/png']]);
    expect(rows.recomputed).toEqual([id]);
    expect([...warnings].sort()).toEqual([
      '1 votes by users not imported dropped', '1 malformed votes dropped',
      '1 filesURL entries not copied to object storage dropped (re-export with --copy-attachments)', '1 malformed filesURL entries dropped'].sort());
  });

  test('idsAreStableAcrossRuns', async () => {
    expect(proposalId('doc-1')).toBe(proposalId('doc-1'));
    expect(proposalId('doc-1')).not.toBe(proposalId('doc-2'));
    const d = doc('comments', [{ author: 'uid-voter', comment: 'hola', dateTime: '2024-05-03T00:00:00Z' }]);
    await importer.importProposal('doc-1', d, warnings);
    await importer.importProposal('doc-1', d, warnings);
    expect(rows.comments.length).toBe(2);
    expect(rows.comments[0]!.id).toBe(rows.comments[1]!.id);
  });

  test('commentIdsCannotBeRecomputedFromTheirInputs', async () => {
    const d = doc('comments', [{ author: 'uid-voter', comment: 'hola', dateTime: '2024-05-03T00:00:00Z',
      replies: [{ author: 'uid-author', comment: 'r', dateTime: '2024-05-04T00:00:00Z' }] }]);
    await importer.importProposal('doc-1', d, warnings);
    const flat = flattenComments(d.comments, CREATED);
    expect(rows.comments.length).toBe(2);
    for (let i = 0; i < flat.length; i++) {
      const id = rows.comments[i]!.id;
      const key = flat[i]!.key;
      for (const plain of [`firestore:propuestas:doc-1:comment:${key}`, `firestore-comment:doc-1:${key}`, `doc-1:${key}`, key]) {
        expect(id).not.toBe(nameUuid(plain));
      }
      expect(id[14]).toBe('4');
    }
    const first = rows.comments.map((c) => c.id);
    rows = new RecordingRows();
    await makeImporter('b3RoZXItand0LXNlY3JldC1rZXktMzJieXRlcy1sb25nIQ==').importProposal('doc-1', d, warnings);
    for (const c of rows.comments) expect(first).not.toContain(c.id);
  });

  test('existingDocumentIsLockedAndReportsWhetherRowsWereAdded', async () => {
    rows.proposalIsNew = false;
    rows.voteIsNew = false;
    const id = proposalId('doc-1');
    rows.existingAliases.set(id, new Map([[author, 'AlfaRojo']]));
    const d = doc('votes', { 'uid-voter': { like: true } });
    expect(await importer.importProposal('doc-1', d, warnings)).toBe('SKIPPED');
    expect(rows.locked).toEqual([id]);
    expect(rows.aliasRows).toEqual([]);
    rows.voteIsNew = true;
    expect(await importer.importProposal('doc-1', d, warnings)).toBe('UPDATED');
  });

  test('takenOrOverlongAliasesAreReplaced', async () => {
    const id = proposalId('doc-1');
    rows.existingAliases.set(id, new Map([[crypto.randomUUID(), 'AlfaRojo']]));
    await importer.importProposal('doc-1', doc('userNames', { 'uid-author': 'AlfaRojo', 'uid-voter': 'x'.repeat(41) }), warnings);
    expect(rows.aliasRows).toEqual([[id, author, 'GeneradoUno'], [id, voter, 'GeneradoDos']]);
    expect(generator.takenSeen).toEqual([new Set(['AlfaRojo']), new Set(['AlfaRojo', 'GeneradoUno'])]);
  });

  test('rejectedKeepsItsReasonAndPendingHasNoModerator', async () => {
    await importer.importProposal('doc-r', doc('authorized', 2, 'rejectionReason', ' Duplicada ', 'mod', 'uid-voter'), warnings);
    await importer.importProposal('doc-p', doc('authorized', 0, 'rejectionReason', 'no aplica', 'mod', 'uid-voter'), warnings);
    expect(rows.proposals[0]).toMatchObject({ status: 'REJECTED', rejectionReason: 'Duplicada', moderatedBy: voter });
    expect(rows.proposals[1]).toMatchObject({ status: 'PENDING', rejectionReason: null, moderatedBy: null });
  });

  test('missingAuthorDateAndLongTextAreWarnedNotFatal', async () => {
    const d = doc('author', 'uid-ghost', 'dateTime', null, 'title', 't'.repeat(120), 'description', 'd'.repeat(5001));
    const users: ImportUsers = { async findByFirebaseUidIn() { return new Map([['uid-voter', voter]]); }, async isDeletedFirebaseAccount() { return false; } };
    const imp = new ProposalFirestoreImporter(rows, users, generator, () => NOW, ContentHmac.fromJwtSecret(SECRET));
    expect(await imp.importProposal('doc-1', d, warnings)).toBe('CREATED');
    expect(rows.proposals.length).toBe(1);
    expect(rows.proposals[0]).toMatchObject({ authorId: null, title: 't'.repeat(100), description: 'd'.repeat(5000), topic: 'OTROS', createdAt: NOW });
    expect([...warnings].sort()).toEqual(['title longer than 100 characters truncated', 'description longer than 5000 characters truncated',
      'missing topic; filed under OTROS', 'missing or invalid dateTime; import time used', 'author not imported; proposal kept without author'].sort());
    expect(rows.aliasRows).toEqual([]);
  });

  test('missingTitleIsAnError', async () => {
    await expect(importer.importProposal('doc-1', doc('title', '  '), warnings)).rejects.toThrow(new FirestoreImportError('missing title'));
    expect(rows.proposals).toEqual([]);
  });

  test('commentsFromUnknownUsersBlankOnesAndLongOnes', async () => {
    const replies = [{ author: 'uid-author', comment: 'respuesta' }];
    const d = doc('comments', [
      { author: 'uid-ghost', comment: 'anónimo' },
      { author: 'uid-voter', comment: ' ' },
      { author: 'uid-voter', comment: '', replies },
      { author: 'uid-voter', comment: 'c'.repeat(1001) },
    ]);
    await importer.importProposal('doc-1', d, warnings);
    expect(rows.tombstones.length).toBe(1);
    expect(rows.tombstones[0]!.parentId).toBeNull();
    const anchor = rows.tombstones[0]!.id;
    expect(rows.comments.map((c) => [c.body, c.authorId, c.parentId])).toEqual([
      ['anónimo', null, null], ['respuesta', author, anchor], ['c'.repeat(1000), voter, null]]);
    expect(warnings).toContain('1 comments by users not imported kept without author');
    expect(warnings).toContain('2 blank comments dropped');
    expect(warnings).toContain('1 comments longer than 1000 characters truncated');
  });

  test('nonMapVotesAreIgnoredWithAWarning', async () => {
    await importer.importProposal('doc-1', doc('votes', 3), warnings);
    expect(rows.votes).toEqual([]);
    expect(warnings).toContain('votes is not a map; ignored');
  });

  test('isAlwaysAvailable', () => {
    expect(importer.isAvailable()).toBe(true);
  });
});
