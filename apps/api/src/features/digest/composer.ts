// service/digest/DigestComposer: an issue's email. The shared content (same
// for every recipient, rendered once), the audience, and per recipient only
// the unsubscribe link and the personal section ("Tu cuatrimestre").

import type { Deps } from '../../deps';
import type { Db } from '../../db/client';
import type { OutgoingEmail } from '../../infra/mail';
import type { Logger } from '../../infra/logger';
import { javaIsBlank, javaTrim, javaUrlEncode } from '../../lib/javaCompat';
import { CapabilityService } from '../capability/service';
import { KIND_DIGEST, KIND_TEST } from '../mail/logic/mailSendService';
import { isAllowedRecipient, type MailSettings } from '../mail/settings';
import type { DigestCandidates, DigestOrg, DigestShared } from './logic/digestContent';
import { digestTemplate, type DigestRenderOutput, type DigestTemplate, type PersonalSection } from './logic/digestRenderer';
import { digestIncluded } from './logic/digestSelection';
import type { DigestUnsubscribeTokens } from './logic/digestUnsubscribeTokens';
import { DigestWeek } from './logic/digestWeek';
import type { TuCuatrimestreSection } from './personal';
import * as repo from './repo';

/** The digest is CEITBA's email: its audience is CEITBA's followers. */
export const AUDIENCE_ORG = 'ceitba';
const CAPABILITY_BATCH = 500;

/** DigestComposer.Issue: entity-free copy of an issue's editable fields. */
export interface ComposerIssue {
  id: string;
  week: DigestWeek;
  subject: string;
  intro: string | null;
  excludedArticleIds: string[];
  excludedEventIds: string[];
}

export const issueOf = (i: repo.IssueRow): ComposerIssue => ({
  id: i.id, week: new DigestWeek(i.weekStart), subject: i.subject, intro: i.intro,
  excludedArticleIds: i.excludedArticleIds, excludedEventIds: i.excludedEventIds,
});

const org = (slug: string | null, name: string | null): DigestOrg | null =>
  slug == null ? null : { slug, name: name != null && !javaIsBlank(name) ? name : slug };

export class DigestComposer {
  constructor(private readonly deps: Deps, private readonly settings: MailSettings, private readonly tokens: DigestUnsubscribeTokens,
              private readonly personal: TuCuatrimestreSection, private readonly log: Logger) {}

  async candidates(db: Db, week: DigestWeek): Promise<DigestCandidates> {
    const articles = (await repo.findPublishedArticlesBetween(db, week.weekStart, week.weekEnd())).map((x) => ({
      id: x.id, title: x.title, excerpt: x.excerpt, coverImage: x.coverImage, publishedAt: x.publishedAt, organization: org(x.orgSlug, x.orgName),
    }));
    const events = (await repo.findDigestEventCandidates(db, week.eventsFrom(), week.eventsTo(), week.announcedFrom(), week.announcedTo()))
      .map((x) => ({
        id: x.id, title: x.title, eventDate: x.eventDate, startTime: x.startTime, endTime: x.endTime, location: x.location,
        organization: org(x.orgSlug, x.orgName), signup: x.signupMode !== 'none',
      }));
    return { week, articles, events };
  }

  async content(db: Db, issue: ComposerIssue): Promise<DigestShared> {
    return digestIncluded(await this.candidates(db, issue.week), issue.excludedArticleIds, issue.excludedEventIds);
  }

  /** Followers of CEITBA with the digest on, an allowed-domain email and the resumen_semanal capability. */
  async recipients(db: Db): Promise<{ userId: string; email: string }[]> {
    const allowed = (await repo.findDigestAudience(db, AUDIENCE_ORG)).filter((u) => isAllowedRecipient(this.settings, u.email));
    const out: { userId: string; email: string }[] = [];
    const caps = new CapabilityService(this.deps);
    for (let i = 0; i < allowed.length; i += CAPABILITY_BATCH) {
      const batch = allowed.slice(i, i + CAPABILITY_BATCH);
      const holders = await caps.holders('resumen_semanal', batch, db);
      for (const u of batch) if (holders.has(u.id)) out.push({ userId: u.id, email: javaTrim(u.email) });
    }
    return out;
  }

  recipientCount(db: Db): Promise<number> {
    return repo.countDigestAudienceWithCapability(db, AUDIENCE_ORG, this.settings.digest.allowedDomains, 'resumen_semanal', this.deps.clock.now());
  }

  /** Re-checked right before sending to a snapshotted recipient. */
  async stillEligible(db: Db, userId: string, email: string): Promise<boolean> {
    const u = await repo.findUser(db, userId);
    return u != null && u.digestEmailEnabled && isAllowedRecipient(this.settings, email)
      && (await repo.isFollowing(db, userId, AUDIENCE_ORG))
      && (await new CapabilityService(this.deps).has(u, 'resumen_semanal', db));
  }

  template(issue: ComposerIssue, content: DigestShared): DigestTemplate {
    return digestTemplate({ subject: issue.subject, week: issue.week, intro: issue.intro, digest: content, publicBaseUrl: this.settings.digest.publicBaseUrl });
  }

  /** readerId null = a preview without a reader (inert unsubscribe link). */
  async render(db: Db, issue: ComposerIssue, template: DigestTemplate, readerId: string | null): Promise<DigestRenderOutput> {
    return this.renderWith(template, readerId, await this.personalSection(db, issue, readerId));
  }

  renderWith(template: DigestTemplate, readerId: string | null, personal: PersonalSection | null): DigestRenderOutput {
    return template.forReader(personal, this.unsubscribePageUrl(readerId));
  }

  /** A failure only costs the personal block: the shared digest still goes out. */
  async personalSections(db: Db, issue: ComposerIssue, readerIds: string[]): Promise<Map<string, PersonalSection>> {
    if (readerIds.length === 0) return new Map();
    try {
      return await this.personal.forReaders(db, readerIds, issue.week);
    } catch (e) {
      this.log.warn({ err: e }, `Digest ${issue.week.weekStart}: personal sections unavailable, sending without them: ${(e as Error).message}`);
      return new Map();
    }
  }

  private async personalSection(db: Db, issue: ComposerIssue, readerId: string | null): Promise<PersonalSection | null> {
    if (readerId == null) return null;
    return (await this.personalSections(db, issue, [readerId])).get(readerId) ?? null;
  }

  async email(db: Db, issue: ComposerIssue, template: DigestTemplate, userId: string, to: string, test: boolean): Promise<OutgoingEmail> {
    const out = this.renderWith(template, userId, await this.personalSection(db, issue, userId));
    const headers: Record<string, string> = {
      // RFC 2369 + RFC 8058 one-click: mail clients POST to the API directly.
      'List-Unsubscribe': `<${this.settings.digest.apiBaseUrl}/v1/digests/unsubscribe?token=${javaUrlEncode(this.tokens.issue(userId))}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      'List-Id': 'La semana en ITBA <digest.ceitba.org.ar>',
    };
    if (!test) headers.Precedence = 'bulk';
    return { to, subject: test ? `[Prueba] ${issue.subject}` : issue.subject, html: out.html, text: out.text, headers, kind: test ? KIND_TEST : KIND_DIGEST };
  }

  /** The ItbaNews page that calls POST /v1/digests/unsubscribe. */
  unsubscribePageUrl(readerId: string | null): string {
    const token = readerId == null ? 'preview' : this.tokens.issue(readerId);
    return `${this.settings.digest.publicBaseUrl}/unsubscribe?token=${javaUrlEncode(token)}`;
  }
}
