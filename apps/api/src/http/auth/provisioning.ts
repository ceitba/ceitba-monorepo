// service/auth/UserProvisioningService.findOrCreate: JIT user rows. Runs in
// its own transaction (REQUIRES_NEW) so the row survives a failing request.

import { eq } from 'drizzle-orm';
import type { Database } from '../../db/client';
import { isUniqueViolation, withTx } from '../../db/client';
import { user } from '../../db/schema/identity';
import { toPgTimestamp, type Micros } from '../../lib/time';
import type { Logger } from '../../infra/logger';
import { claimInvites, findUserByEmail, followIfMissing, type UserRow } from './repo';

export async function findOrCreateUser(
  db: Database,
  log: Logger,
  now: Micros,
  email: string,
  name: string | null,
  googleSub: string | null,
  avatarUrl: string | null,
): Promise<UserRow> {
  const existing = await findUserByEmail(db, email);
  if (existing) return syncProfile(db, existing, name, googleSub, avatarUrl, now);
  try {
    return await withTx(db, async (tx) => {
      const ts = toPgTimestamp(now);
      // Hibernate inserts every column: preferred_language/theme stay NULL (not the 'es' default).
      const [created] = await tx.insert(user).values({
        id: crypto.randomUUID(), email, name, googleSub, avatarUrl,
        fileNumber: null, careerId: null, plan: null, preferredLanguage: null, theme: null,
        linkedin: null, instagram: null, discord: null, firebaseUid: null, digestEmailEnabled: true,
        createdAt: ts, updatedAt: ts,
      }).returning();
      try {
        await followIfMissing(tx, created!.id, 'ceitba');
      } catch (e) {
        log.warn(`Auto-follow CEITBA failed for user ${created!.id}: ${(e as Error).message}`);
      }
      // Pending org invites of this email (docs/ORGANIZATIONS.md).
      await claimInvites(tx, created!.id, email);
      return created!;
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      const raced = await findUserByEmail(db, email);
      if (raced) return raced;
    }
    throw e;
  }
}

async function syncProfile(db: Database, u: UserRow, name: string | null, googleSub: string | null, avatarUrl: string | null, now: Micros): Promise<UserRow> {
  const patch: Partial<UserRow> = {};
  if (name !== null && name !== u.name) patch.name = name;
  if (googleSub !== null && googleSub !== u.googleSub) patch.googleSub = googleSub;
  if (avatarUrl !== null && avatarUrl !== u.avatarUrl) patch.avatarUrl = avatarUrl;
  if (Object.keys(patch).length === 0) return u;
  const [updated] = await db.update(user).set({ ...patch, updatedAt: toPgTimestamp(now) }).where(eq(user.id, u.id)).returning();
  return updated ?? u;
}
