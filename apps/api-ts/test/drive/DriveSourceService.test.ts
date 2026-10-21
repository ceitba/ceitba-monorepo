// Port of apps/api/src/test/java/org/ceitba/api/service/drive/DriveSourceServiceTest.java (in-process: the
// Java test mocks the repositories; here the BLOCKED row is real), plus in-process checks of what no Java test
// covers end to end: community archive expansion (DriveCommunityService against the fake) and the
// DriveSyncJob registration (JobLock DRIVE_SYNC, id 9).
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { seedUser } from '../../contract/support/identity';
import { FakeDriveClient } from '../../src/external/drive';
import { DriveError } from '../../src/features/drive/errors';
import jobs from '../../src/features/drive/jobs';
import { featureJobs } from '../../src/jobs/scheduler';
import { driveServices } from '../../src/features/drive/services';
import { CONSENT_VERSION } from '../../src/features/drive/sourceService';
import { JOBS } from '../../src/jobs/joblock';
import { InMemoryObjectStorage } from '../media/support/InMemoryObjectStorage';
import { testApp, type TestApp } from '../support/app';

class CountingDrive extends FakeDriveClient {
  gets = 0;
  override async getFile(id: string) {
    this.gets++;
    return super.getFile(id);
  }
}

let t: TestApp;
const drive = new CountingDrive();
beforeAll(async () => {
  t = await testApp({ overrides: { drive, storage: new InMemoryObjectStorage() } });
}, 60_000);
afterAll(async () => {
  await driveServices(t.deps).trigger.idle();
  driveServices(t.deps).pool.close();
  await t?.close();
});

describe('DriveSourceServiceTest', () => {
  beforeEach(async () => {
    await t.sql`TRUNCATE wiki.drive_file, wiki.drive_source, public."user", public.subject CASCADE`;
    drive.reset();
    drive.gets = 0;
  });

  test('aFolderStaffBlockedCannotBeRegisteredAgain', async () => {
    const folderId = '1AbCdEfGhIjKlMnOp';
    const other = await seedUser(t.sql, 'otro@itba.edu.ar');
    await t.sql`INSERT INTO wiki.drive_source (id, user_id, root_folder_id, root_name, status, anonymous, consent_version, consented_at,
                created_at, updated_at) VALUES (gen_random_uuid(), ${other}, ${folderId}, 'x', 'BLOCKED', false, '2026-10', now(), now(), now())`;
    const id = await seedUser(t.sql, 'alumno@itba.edu.ar');
    const [user] = await t.sql`SELECT * FROM public."user" WHERE id = ${id}`;
    const err = await driveServices(t.deps).sources.register({ ...user, id, email: 'alumno@itba.edu.ar' } as never,
      { folderUrl: `https://drive.google.com/drive/folders/${folderId}`, consentVersion: CONSENT_VERSION, anonymous: false })
      .then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(DriveError);
    expect((err as DriveError).reason).toBe('SOURCE_BLOCKED');
    expect(drive.gets).toBe(0);
  });

  test('communityArchiveFoldersBecomeOneSourceEachAndAreSyncedAsCommunityContent', async () => {
    await t.sql`INSERT INTO public.subject (id, name, credits, updated_at) VALUES ('12.43', 'Ciencia de Materiales', 6, now()), ('93.41', 'Física I', 6, now())`;
    drive.folder('arch', '1-Materias', null, 'archivo@gmail.com')
      .folder('m1', '12.43 - 12.44 - Ciencia de Materiales', 'arch', 'archivo@gmail.com')
      .file('m1-pdf', 'Final 2019.pdf', 'application/pdf', 'm1', 'contrib@gmail.com', FakeDriveClient.pdf('final'))
      .file('m1-img', 'foto.png', 'image/png', 'm1', 'contrib@gmail.com', FakeDriveClient.tinyPng())
      .folder('m0', '00.00 - ORGANIZAR', 'arch', 'archivo@gmail.com')
      .folder('m9', '99.99 - No existe', 'arch', 'archivo@gmail.com');
    await t.sql`INSERT INTO wiki.drive_source (id, kind, display_name, storage_mode, root_folder_id, root_name, status, anonymous,
                consent_version, consented_at, approved_at, created_at, updated_at)
                VALUES (gen_random_uuid(), 'COMMUNITY_ROOT', 'Comunidad', 'REFERENCE', 'arch', '1-Materias', 'ACTIVE', false, 'community', now(), now(), now(), now())`;
    await driveServices(t.deps).sync.runAll();
    const sources = await t.sql`SELECT * FROM wiki.drive_source WHERE kind = 'COMMUNITY'`;
    expect(sources.map((s) => [s.root_folder_id, s.subject_id, s.status, s.storage_mode, s.owner_email])).toEqual([['m1', '12.43', 'ACTIVE', 'REFERENCE', 'archivo@gmail.com']]);
    const files = await t.sql`SELECT drive_id, owner_email, owned_by_sharer, publication, effective_subject_id, by_reference, text_content
                              FROM wiki.drive_file ORDER BY drive_id`;
    // Images are skipped in community sources; the contributor's address is never stored.
    expect(files.map((f) => [f.drive_id, f.owner_email, f.owned_by_sharer, f.publication, f.effective_subject_id, f.by_reference, f.text_content]))
      .toEqual([['m1-pdf', null, true, 'PUBLISHED', '12.43', true, 'final']]);
    // The folder leaves the archive: its source is disconnected and its rows go.
    drive.remove('m1');
    await driveServices(t.deps).sync.runAll();
    expect((await t.sql`SELECT status FROM wiki.drive_source WHERE kind = 'COMMUNITY'`).map((s) => s.status)).toEqual(['DISCONNECTED']);
    expect((await t.sql`SELECT count(*)::int AS n FROM wiki.drive_file`)[0]!.n).toBe(0);
  });

  test('DriveSyncJob: fixed delay, initial PT1M, JobLock DRIVE_SYNC (id 9), off unless DRIVE_SYNC_ENABLED', async () => {
    const [job] = (await featureJobs(jobs, t.deps)).jobs;
    expect(job!.name).toBe('DriveSyncJob#run');
    expect(job!.lock).toBe('DRIVE_SYNC');
    expect(JOBS.DRIVE_SYNC.id).toBe(9);
    expect(job!.schedule).toEqual({ fixedDelayMs: 30 * 60_000, initialDelayMs: 60_000 });
    expect(job!.enabled).toBe(false);
  });
});
