// service/staff/{StaffService, ModeratorService, StaffRosterService, BenefitService, BenefitCardService}.

import type { Deps } from '../../deps';
import { withTx } from '../../db/client';
import {
  InvalidBenefitSlugError, LastActiveStaffError, ResourceAlreadyExistsError, ResourceNotFoundError, ValidationError,
} from '../../http/errors';
import { javaIsBlank, javaTrim } from '../../lib/javaCompat';
import { ART, formatOffsetDateTime, parsePgTimestamp, systemNowMicros, toPgTimestamp, type Micros } from '../../lib/time';
import type {
  AssignStaffRequest, BenefitCardResponse, BenefitResponse, CreateBenefitCardRequest, CreateStaffMemberRequest, ModeratorResponse,
  StaffDepartmentResponse, StaffMemberResponse, StaffResponse, UpdateBenefitCardRequest, UpdateBenefitRequest,
  UpdateStaffDepartmentRequest, UpdateStaffMemberRequest,
} from './dto';
import * as repo from './repo';

const fromDb = (pg: string) => formatOffsetDateTime(parsePgTimestamp(pg));

/**
 * OffsetDateTime.toString() of a value Jackson bound from a request (adjusted
 * to UTC): `2027-01-01T00:00Z`, seconds only when non-zero, fraction in groups of 3.
 */
export function javaOffsetDateTimeToString(us: Micros): string {
  const iso = formatOffsetDateTime(us, 'UTC'); // yyyy-MM-ddTHH:mm:ss[.f]Z
  const m = /^(.*T\d{2}:\d{2}):(\d{2})(?:\.(\d+))?Z$/.exec(iso)!;
  const frac = (m[3] ?? '').padEnd(6, '0');
  const micros = Number(frac || 0);
  if (m[2] === '00' && micros === 0) return `${m[1]}Z`;
  let f = '';
  if (micros !== 0) f = micros % 1000 === 0 ? `.${frac.slice(0, 3)}` : `.${frac}`;
  return `${m[1]}:${m[2]}${f}Z`;
}

// ------------------------------------------------------------ StaffService

export class StaffService {
  constructor(private readonly deps: Deps) {}

  /** findAllActive(OffsetDateTime.now()) ORDER BY user_id. */
  listActive(): Promise<StaffResponse[]> {
    return withTx(this.deps.db, async (tx) => (await repo.findAllActiveStaff(tx, toPgTimestamp(systemNowMicros())))
      .map((r) => toStaff(r.staff, r.email, r.name)), { readOnly: true });
  }

  assign(req: AssignStaffRequest): Promise<StaffResponse> {
    return withTx(this.deps.db, async (tx) => {
      const start = req.start!;
      const end = req.end!;
      if (!(start < end)) throw new ValidationError('start', javaOffsetDateTimeToString(start), 'must be before end');
      const u = await repo.findUserByEmail(tx, req.email!);
      if (!u) throw new ResourceNotFoundError('User', req.email);
      // PK is user_id: an active membership conflicts; an expired or future row is replaced.
      const nowPg = toPgTimestamp(systemNowMicros());
      if (await repo.findStaff(tx, u.id)) {
        if (await repo.isActiveStaffAt(tx, u.id, nowPg)) throw new ResourceAlreadyExistsError('CeitbaStaff', req.email);
        await repo.deleteStaff(tx, u.id);
      }
      await repo.insertStaff(tx, { userId: u.id, branch: req.branch!, role: req.role!, start: toPgTimestamp(start), end: toPgTimestamp(end) });
      // The entity in memory: start/end as Jackson bound them (UTC).
      return {
        email: u.email, name: u.name, branch: req.branch!, role: req.role!,
        start: formatOffsetDateTime(start), end: formatOffsetDateTime(end), user_id: u.id,
      };
    });
  }

  /**
   * End-dates the membership at now (kept for audit). A not-yet-started one is
   * deleted; an ended one is 404; the last active staff member cannot be revoked.
   */
  revoke(userId: string): Promise<void> {
    return withTx(this.deps.db, async (tx) => {
      const staff = await repo.findStaff(tx, userId);
      if (!staff) throw new ResourceNotFoundError('CeitbaStaff', userId);
      const now = systemNowMicros();
      if (parsePgTimestamp(staff.start) > now) {
        await repo.deleteStaff(tx, userId);
        return;
      }
      if (parsePgTimestamp(staff.end) < now) throw new ResourceNotFoundError('CeitbaStaff', userId);
      const others = (await repo.lockActiveStaff(tx, toPgTimestamp(now))).some((s) => s.userId !== userId);
      if (!others) {
        throw new LastActiveStaffError('Cannot revoke the only active staff member. Grant the STAFF role to someone else first.');
      }
      await repo.deleteStaff(tx, userId);
      await repo.insertStaff(tx, { userId, branch: staff.branch, role: staff.role, start: staff.start, end: toPgTimestamp(now) });
    });
  }
}

function toStaff(s: repo.StaffRow, email: string, name: string | null): StaffResponse {
  return { email, name, branch: s.branch, role: s.role, start: fromDb(s.start), end: fromDb(s.end), user_id: s.userId };
}

// ------------------------------------------------------------ ModeratorService

export class ModeratorService {
  constructor(private readonly deps: Deps) {}

  /** Explicit grants only (staff-implied moderators are not listed), oldest grant first. */
  listActive(): Promise<ModeratorResponse[]> {
    return withTx(this.deps.db, async (tx) => {
      const grants = await repo.activeModerators(tx);
      // One batched lookup instead of a findById per grant.
      const byId = new Map((await repo.usersByIds(tx, grants.map((g) => g.userId))).map((u) => [u.id, u]));
      return grants.map((g) => {
        const u = byId.get(g.userId);
        return { userId: g.userId, email: u?.email ?? null, name: u?.name ?? null, grantedBy: g.grantedBy, grantedAt: fromDb(g.grantedAt) };
      });
    }, { readOnly: true });
  }

  grant(email: string, grantedBy: string | null): Promise<ModeratorResponse> {
    return withTx(this.deps.db, async (tx) => {
      const u = await repo.findUserByEmail(tx, email);
      if (!u) throw new ResourceNotFoundError('User', email);
      // OffsetDateTime.now(clock): the ART clock, printed with its offset.
      const now = this.deps.clock.now();
      const existing = await repo.findModerator(tx, u.id);
      if (existing) {
        if (existing.revokedAt === null) throw new ResourceAlreadyExistsError('Moderator', email);
        await repo.updateModerator(tx, u.id, { grantedBy, grantedAt: toPgTimestamp(now), revokedAt: null, revokedBy: null });
      } else {
        await repo.insertModerator(tx, u.id, grantedBy, toPgTimestamp(now));
      }
      return { userId: u.id, email: u.email, name: u.name, grantedBy, grantedAt: formatOffsetDateTime(now, this.deps.clock.zone ?? ART) };
    });
  }

  /** Revoke keeps the row for audit (revoked_at / revoked_by). */
  revoke(userId: string, revokedBy: string | null): Promise<void> {
    return withTx(this.deps.db, async (tx) => {
      const g = await repo.findModerator(tx, userId);
      if (!g || g.revokedAt !== null) throw new ResourceNotFoundError('Moderator', userId);
      await repo.updateModerator(tx, userId, { revokedBy, revokedAt: toPgTimestamp(this.deps.clock.now()) });
    });
  }
}

// ------------------------------------------------------------ StaffRosterService

export class StaffRosterService {
  constructor(private readonly deps: Deps) {}

  listDepartments(): Promise<StaffDepartmentResponse[]> {
    return withTx(this.deps.db, async (tx) => (await repo.allDepartments(tx)).map(toDepartment), { readOnly: true });
  }

  updateDepartment(slug: string, req: UpdateStaffDepartmentRequest): Promise<StaffDepartmentResponse> {
    return withTx(this.deps.db, async (tx) => {
      const d = await repo.findDepartment(tx, slug);
      if (!d) throw new ResourceNotFoundError('StaffDepartment', slug);
      await repo.updateDepartment(tx, slug, req.colorVar!, req.displayOrder!, toPgTimestamp(systemNowMicros()));
      return { slug: d.slug, colorVar: req.colorVar!, displayOrder: req.displayOrder! };
    });
  }

  listYears(): Promise<number[]> {
    return withTx(this.deps.db, (tx) => repo.distinctYearsDesc(tx), { readOnly: true });
  }

  listMembers(year: number): Promise<StaffMemberResponse[]> {
    return withTx(this.deps.db, async (tx) => (await repo.membersOfYear(tx, year)).map(toMember), { readOnly: true });
  }

  createMember(req: CreateStaffMemberRequest): Promise<StaffMemberResponse> {
    return withTx(this.deps.db, async (tx) => {
      await this.requireDepartment(tx, req.departmentSlug!);
      const ts = toPgTimestamp(systemNowMicros());
      const row = {
        id: crypto.randomUUID(), year: req.year!, departmentSlug: req.departmentSlug!, displayOrder: req.displayOrder!,
        name: req.name!, roleEs: req.roleEs!, roleEn: req.roleEn!, photoUrl: req.photoUrl, linkedinUrl: req.linkedinUrl, email: req.email,
      };
      await repo.insertMember(tx, { ...row, createdAt: ts, updatedAt: ts });
      return toMember(row);
    });
  }

  updateMember(id: string, req: UpdateStaffMemberRequest): Promise<StaffMemberResponse> {
    return withTx(this.deps.db, async (tx) => {
      if (!(await repo.findMember(tx, id))) throw new ResourceNotFoundError('StaffMember', id);
      await this.requireDepartment(tx, req.departmentSlug!);
      const row = {
        id, year: req.year!, departmentSlug: req.departmentSlug!, displayOrder: req.displayOrder!,
        name: req.name!, roleEs: req.roleEs!, roleEn: req.roleEn!, photoUrl: req.photoUrl, linkedinUrl: req.linkedinUrl, email: req.email,
      };
      const { id: _id, ...set } = row;
      await repo.updateMember(tx, id, { ...set, updatedAt: toPgTimestamp(systemNowMicros()) });
      return toMember(row);
    });
  }

  deleteMember(id: string): Promise<void> {
    return withTx(this.deps.db, async (tx) => {
      if (!(await repo.findMember(tx, id))) throw new ResourceNotFoundError('StaffMember', id);
      await repo.deleteMember(tx, id);
    });
  }

  private async requireDepartment(tx: Parameters<typeof repo.findDepartment>[0], slug: string) {
    if (!(await repo.findDepartment(tx, slug))) throw new ResourceNotFoundError('StaffDepartment', slug);
  }
}

const toDepartment = (d: repo.DepartmentRow): StaffDepartmentResponse => ({ slug: d.slug, colorVar: d.colorVar, displayOrder: d.displayOrder });

function toMember(m: Pick<repo.MemberRow, 'id' | 'year' | 'departmentSlug' | 'displayOrder' | 'name' | 'roleEs' | 'roleEn' | 'photoUrl' | 'linkedinUrl' | 'email'>): StaffMemberResponse {
  return {
    id: m.id, year: m.year, departmentSlug: m.departmentSlug, displayOrder: m.displayOrder, name: m.name,
    roleEs: m.roleEs, roleEn: m.roleEn, photoUrl: m.photoUrl, linkedinUrl: m.linkedinUrl, email: m.email,
  };
}

// ------------------------------------------------------------ BenefitService

// Same rule as OrganizationRequest.slug.
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** BenefitService.blankToNull: trims. */
const blankToNullTrim = (s: string | null) => (s == null || javaIsBlank(s) ? null : javaTrim(s));

export class BenefitService {
  constructor(private readonly deps: Deps) {}

  list(): Promise<BenefitResponse[]> {
    return withTx(this.deps.db, async (tx) => (await repo.allBenefits(tx)).map(toBenefit), { readOnly: true });
  }

  create(slug: string, req: UpdateBenefitRequest): Promise<BenefitResponse> {
    return withTx(this.deps.db, async (tx) => {
      if (slug.length < 2 || slug.length > 40 || !SLUG.test(slug)) {
        throw new InvalidBenefitSlugError(new ValidationError('slug', slug, 'must be 2-40 lowercase letters, digits or single hyphens').message);
      }
      if (await repo.benefitExists(tx, slug)) throw new ResourceAlreadyExistsError('Benefit', slug);
      const ts = toPgTimestamp(systemNowMicros());
      const row: repo.BenefitRow = {
        slug, colorVar: req.colorVar!, displayOrder: req.displayOrder!, linkUrl: null, contactEmail: null,
        highlightsEs: [], highlightsEn: [], createdAt: ts, updatedAt: ts, nameEs: null, nameEn: null,
      };
      applyTo(row, req);
      await repo.insertBenefit(tx, row);
      return toBenefit(row);
    });
  }

  update(slug: string, req: UpdateBenefitRequest): Promise<BenefitResponse> {
    return withTx(this.deps.db, async (tx) => {
      const b = await repo.findBenefit(tx, slug);
      if (!b) throw new ResourceNotFoundError('Benefit', slug);
      b.colorVar = req.colorVar!;
      applyTo(b, req);
      b.updatedAt = toPgTimestamp(systemNowMicros());
      const { slug: _s, createdAt: _c, ...set } = b;
      await repo.updateBenefit(tx, slug, set);
      return toBenefit(b);
    });
  }

  delete(slug: string): Promise<void> {
    return withTx(this.deps.db, async (tx) => {
      if (!(await repo.benefitExists(tx, slug))) throw new ResourceNotFoundError('Benefit', slug);
      await repo.deleteBenefit(tx, slug);
    });
  }
}

function applyTo(b: repo.BenefitRow, req: UpdateBenefitRequest) {
  b.displayOrder = req.displayOrder!;
  b.linkUrl = req.linkUrl;
  b.contactEmail = req.contactEmail;
  b.highlightsEs = (req.highlightsEs ?? []) as string[];
  b.highlightsEn = (req.highlightsEn ?? []) as string[];
  // Names postdate the SPA's editor, which omits them: null keeps the stored value; "" clears.
  if (req.nameEs !== null) b.nameEs = blankToNullTrim(req.nameEs);
  if (req.nameEn !== null) b.nameEn = blankToNullTrim(req.nameEn);
}

function toBenefit(b: repo.BenefitRow): BenefitResponse {
  return {
    slug: b.slug, colorVar: b.colorVar, displayOrder: b.displayOrder, linkUrl: b.linkUrl, contactEmail: b.contactEmail,
    highlightsEs: b.highlightsEs ?? [], highlightsEn: b.highlightsEn ?? [], nameEs: b.nameEs, nameEn: b.nameEn,
  };
}

// ------------------------------------------------------------ BenefitCardService

/** BenefitCardService.blankToNull: no trim. */
const blankToNull = (s: string | null) => (s == null || javaIsBlank(s) ? null : s);
const cleanList = (l: (string | null)[] | null): string[] => (l == null ? [] : l.filter((s): s is string => s != null && !javaIsBlank(s)).map(javaTrim));

export class BenefitCardService {
  constructor(private readonly deps: Deps) {}

  list(): Promise<BenefitCardResponse[]> {
    return withTx(this.deps.db, async (tx) => (await repo.allBenefitCards(tx)).map(toCard), { readOnly: true });
  }

  create(req: CreateBenefitCardRequest): Promise<BenefitCardResponse> {
    return withTx(this.deps.db, async (tx) => {
      await requireCategory(tx, req.categorySlug!);
      const ts = toPgTimestamp(systemNowMicros());
      const c: repo.BenefitCardRow = {
        id: crypto.randomUUID(), categorySlug: req.categorySlug!, displayOrder: req.displayOrder!, titleEs: req.titleEs!, titleEn: req.titleEn!,
        summaryEs: req.summaryEs ?? '', summaryEn: req.summaryEn ?? '',
        imageUrl: blankToNull(req.imageUrl), ctaUrl: blankToNull(req.ctaUrl), ctaLabelEs: blankToNull(req.ctaLabelEs),
        ctaLabelEn: blankToNull(req.ctaLabelEn), price: blankToNull(req.price),
        bulletsEs: cleanList(req.bulletsEs), bulletsEn: cleanList(req.bulletsEn), createdAt: ts, updatedAt: ts,
        location: blankToNull(req.location), locationUrl: blankToNull(req.locationUrl), phone: blankToNull(req.phone),
        website: blankToNull(req.website), email: blankToNull(req.email),
      };
      await repo.insertBenefitCard(tx, c);
      return toCard(c);
    });
  }

  update(id: string, req: UpdateBenefitCardRequest): Promise<BenefitCardResponse> {
    return withTx(this.deps.db, async (tx) => {
      const c = await repo.findBenefitCard(tx, id);
      if (!c) throw new ResourceNotFoundError('BenefitCard', id);
      await requireCategory(tx, req.categorySlug!);
      Object.assign(c, {
        categorySlug: req.categorySlug!, displayOrder: req.displayOrder!, titleEs: req.titleEs!, titleEn: req.titleEn!,
        summaryEs: req.summaryEs ?? '', summaryEn: req.summaryEn ?? '',
        imageUrl: blankToNull(req.imageUrl), ctaUrl: blankToNull(req.ctaUrl), ctaLabelEs: blankToNull(req.ctaLabelEs),
        ctaLabelEn: blankToNull(req.ctaLabelEn), price: blankToNull(req.price),
        bulletsEs: cleanList(req.bulletsEs), bulletsEn: cleanList(req.bulletsEn),
      });
      // Contact fields postdate the SPA's editor: null keeps the stored value; "" clears.
      if (req.location !== null) c.location = blankToNull(req.location);
      if (req.locationUrl !== null) c.locationUrl = blankToNull(req.locationUrl);
      if (req.phone !== null) c.phone = blankToNull(req.phone);
      if (req.website !== null) c.website = blankToNull(req.website);
      if (req.email !== null) c.email = blankToNull(req.email);
      c.updatedAt = toPgTimestamp(systemNowMicros());
      const { id: _i, createdAt: _c, ...set } = c;
      await repo.updateBenefitCard(tx, id, set);
      return toCard(c);
    });
  }

  delete(id: string): Promise<void> {
    return withTx(this.deps.db, async (tx) => {
      if (!(await repo.findBenefitCard(tx, id))) throw new ResourceNotFoundError('BenefitCard', id);
      await repo.deleteBenefitCard(tx, id);
    });
  }
}

async function requireCategory(tx: Parameters<typeof repo.benefitExists>[0], slug: string) {
  if (!(await repo.benefitExists(tx, slug))) throw new ResourceNotFoundError('Benefit', slug);
}

function toCard(c: repo.BenefitCardRow): BenefitCardResponse {
  return {
    id: c.id, categorySlug: c.categorySlug, displayOrder: c.displayOrder, titleEs: c.titleEs, titleEn: c.titleEn,
    summaryEs: c.summaryEs, summaryEn: c.summaryEn, imageUrl: c.imageUrl, ctaUrl: c.ctaUrl, ctaLabelEs: c.ctaLabelEs,
    ctaLabelEn: c.ctaLabelEn, price: c.price, bulletsEs: c.bulletsEs ?? [], bulletsEn: c.bulletsEn ?? [], location: c.location,
    locationUrl: c.locationUrl, phone: c.phone, website: c.website, email: c.email,
  };
}
