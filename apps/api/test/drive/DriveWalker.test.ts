// Port of apps/api/src/test/java/org/ceitba/api/service/drive/DriveWalkerTest.java
import { describe, expect, test } from 'bun:test';
import { DriveApiError, FOLDER_MIME, SHORTCUT_MIME, type DriveClient, type DriveItem } from '../../src/external/drive';
import { removable } from '../../src/features/drive/store';
import { DriveWalker, entry, walkDone } from '../../src/features/drive/walker';

const PDF = 'application/pdf';
const ME = 'alumno@itba.edu.ar';
const T0 = Date.parse('2026-10-01T12:00:00Z') * 1000;
const DAY = 86_400_000_000;

const item = (id: string, mime: string, owner: string, targetId: string | null, ...parents: string[]): DriveItem => ({
  id, name: `${id}.pdf`, mimeType: mime, parents, ownerEmails: [owner], modifiedTime: null, md5Checksum: null, version: 1, size: null,
  shortcutTargetId: targetId, shortcutTargetMimeType: null, createdTime: null,
});
const folder = (id: string, ...parents: string[]) => item(id, FOLDER_MIME, ME, null, ...parents);
const shortcut = (id: string, target: string) => item(id, SHORTCUT_MIME, ME, target);

/** A mock DriveClient (Mockito when/verify): getFile/listChildren by id, call counts. */
function mockDrive(files: Record<string, DriveItem>, children: Record<string, DriveItem[]>) {
  const listed = new Map<string, number>();
  const drive = {
    available: () => true, botEmail: () => 'bot',
    getFile: async (id: string) => {
      if (files[id]) return files[id]!;
      throw DriveApiError.notFound(id);
    },
    listChildren: async (id: string) => {
      listed.set(id, (listed.get(id) ?? 0) + 1);
      return children[id] ?? [];
    },
    listSharedFolders: async () => [], export: async () => new Blob([]).stream(), download: async () => new Blob([]).stream(),
  } satisfies DriveClient;
  return { drive, listed };
}

/** T0 for the first `calls` reads, a day later afterwards. */
function stoppingAfter(calls: number) {
  let n = 0;
  return () => (++n <= calls ? T0 : T0 + DAY);
}

describe('DriveWalkerTest', () => {
  test('walkResumesAcrossRunsWithoutLoopsAndOnlyACleanCompleteGenerationRemoves', async () => {
    // P > R (root) > A, B;  A > a1, shortcut to R, shortcut to B, shortcut to another student's file;
    // B > C, shortcut to P (above the root);  C > c1, shortcut to a shortcut.
    const { drive, listed } = mockDrive({
      R: folder('R', 'P'), P: folder('P'), B: folder('B', 'R'), other: item('other', PDF, 'otro@itba.edu.ar', null), sX: shortcut('sX', 'a1'),
    }, {
      R: [folder('A', 'R'), folder('B', 'R')],
      A: [item('a1', PDF, ME, null), shortcut('sR', 'R'), shortcut('sB', 'B'), shortcut('sO', 'other')],
      B: [folder('C', 'B'), shortcut('sP', 'P')],
      C: [item('c1', PDF, ME, null), shortcut('sY', 'sX')],
    });

    // Run 1: time for one folder only.
    const first = new DriveWalker(drive, stoppingAfter(1), 100, 30);
    const ancestors = await first.rootAncestors(await drive.getFile('R'));
    expect(ancestors).toEqual(['P']);
    const ctx = { rootId: 'R', ownerEmail: ME, community: false, communityRootId: null, rootAncestors: new Set(ancestors) };
    const r1 = await first.walk(ctx, [entry(0, 'R')], [], T0);
    expect(r1.walked.map((w) => w.item.id)).toEqual(['A', 'B']);
    expect(r1.frontier).toEqual(['1/A', '1/B']);
    expect(walkDone(r1)).toBe(false);

    // Run 2 resumes from the persisted frontier and seen ids.
    const seen = r1.walked.map((w) => w.item.id);
    const second = new DriveWalker(drive, () => T0, 100, 30);
    const r2 = await second.walk(ctx, r1.frontier, seen, T0 + 60_000_000);
    expect(r2.walked.map((w) => w.item.id)).toEqual(['a1', 'C', 'c1']);
    expect(walkDone(r2)).toBe(true);
    expect(r2.incomplete).toBe(false);
    expect(r2.skippedShortcuts).toBe(4);
    expect(listed.get('R')).toBe(1);
    expect(listed.get('B')).toBe(1);

    // Item cap: the generation ends at once, incomplete, with a warning.
    const capped = await new DriveWalker(drive, () => T0, 3, 30).walk(ctx, [entry(0, 'R')], [], T0 + 60_000_000);
    expect(capped.walked).toHaveLength(3);
    expect(walkDone(capped)).toBe(true);
    expect(capped.incomplete).toBe(true);
    expect(capped.warning).toContain('DRIVE_SYNC_MAX_ITEMS_PER_SOURCE');

    // Removal after a complete generation 2: only live rows it did not reach.
    expect(removable({ seenGeneration: 2, removedAt: null }, 2)).toBe(false);
    expect(removable({ seenGeneration: 1, removedAt: null }, 2)).toBe(true);
    expect(removable({ seenGeneration: null, removedAt: null }, 2)).toBe(true);
    expect(removable({ seenGeneration: 1, removedAt: T0 }, 2)).toBe(false);
  });

  test('shortcutIsFollowedOnlyToItemsTheOwnerOwns', async () => {
    const { drive } = mockDrive({
      'own-file-0001': item('own-file-0001', PDF, 'Alumno@itba.edu.ar', null),
      'other-file-01': item('other-file-01', PDF, 'otro@itba.edu.ar', null),
    }, {});
    const walker = new DriveWalker(drive, () => T0, 100, 30);
    const ctx = { rootId: 'R', ownerEmail: ME, community: false, communityRootId: null, rootAncestors: new Set<string>() };
    expect((await walker.resolveShortcut(shortcut('sc-1', 'own-file-0001'), ctx))?.id).toBe('own-file-0001');
    expect(await walker.resolveShortcut(shortcut('sc-2', 'other-file-01'), ctx)).toBeNull();
    expect(await walker.resolveShortcut(shortcut('sc-1', 'own-file-0001'), { ...ctx, ownerEmail: null })).toBeNull();
  });
});
