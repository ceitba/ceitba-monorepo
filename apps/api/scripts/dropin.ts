#!/usr/bin/env bun
// Drop-in check: the Bun API against the Java jar of the last Java commit, on a database shaped like
// production (Prisma-era schema, Flyway baselined at 1, V1.1+ applied by the jar) with data in every area.
//
//   bun scripts/dropin.ts <phase...> --pg postgres://user:pass@host:port --db <name> --jar <jar>
//       [--java-home <JDK 21>] [--out <dir>] [--port-base 18180]
//
// Phases (run in this order; each boots and stops its own servers):
//   seed      bench/load.ts volume + every other area (identities, staff, keys, tokens, proposals, mail
//             accounts encrypted with the app's ciphers, digests, KB admin, drive, legacy wiki ...),
//             then VACUUM ANALYZE (heap order like an autovacuumed production table)
//   enrich    Java on <db> runs the write flows as other users: data the jar itself wrote; VACUUM ANALYZE again
//   get       Java and Bun side by side on <db>: every GET of src/http/openapi.json x 6 identities,
//             status + headers + body bytes; the database must not change (checksummed before/after)
//   writes    clones A (Java) and B (Bun) of <db>, the same write flows in the same order on both,
//             responses compared, then a row-level diff of every table
//   sessions  Java and Bun on <db>: tokens, cookies, refresh tokens and API keys cross runtimes
//
// The database must already be migrated by the jar. Secrets come from the environment (AUTH_JWT_SECRET,
// CONTENT_HMAC_SECRET, KB_SECRETS_KEY, MAIL_TOKEN_ENCRYPTION_KEY); missing ones get local throwaway values.

import { createHash, createHmac } from 'node:crypto';
import { mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import postgres, { type Sql } from 'postgres';
import bcrypt from 'bcryptjs';
import { MailTokenCipher } from '../src/features/mail/logic/mailTokenCipher';
import { KbSecretCipher } from '../src/features/kb/logic/llm/kbSecretCipher';
import { ContentHmac } from '../src/features/crypto/logic/contentHmac';
import { DigestCorrectionVoteTokens } from '../src/features/digest/logic/digestCorrectionVoteTokens';

// ------------------------------------------------------------------ args, env

const argv = process.argv.slice(2);
const opt = (n: string, d?: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1]! : d; };
const phases = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1]!.startsWith('--')));
const PG = opt('pg')!;
const DB = opt('db')!;
const JAR = opt('jar')!;
const JAVA_HOME = opt('java-home', process.env.JAVA_HOME ?? join(homedir(), '.local/jdk/jdk-21.0.12.1+1/Contents/Home'))!;
const OUT = opt('out', join(process.cwd(), '.dropin'))!;
const PORT_BASE = Number(opt('port-base', '18180'));
const API_DIR = join(import.meta.dir, '..');
mkdirSync(OUT, { recursive: true });

const derive = (label: string, bytes = 32) => createHash('sha256').update(`dropin:${label}`).digest().subarray(0, bytes).toString('base64');
const SECRETS = {
  AUTH_JWT_SECRET: process.env.AUTH_JWT_SECRET ?? derive('jwt'),
  CONTENT_HMAC_SECRET: process.env.CONTENT_HMAC_SECRET ?? derive('hmac'),
  KB_SECRETS_KEY: process.env.KB_SECRETS_KEY ?? derive('kb'),
  MAIL_TOKEN_ENCRYPTION_KEY: process.env.MAIL_TOKEN_ENCRYPTION_KEY ?? derive('mail'),
};
const REVIEW_EMAIL = 'appreview@itba.edu.ar';
const REVIEW_PASSWORD = 'dropin-review';

/** Both servers: same secrets, fakes on, every writing job off, rate limit off, prod profile. */
const SERVER_ENV: Record<string, string> = {
  ...SECRETS,
  SPRING_PROFILES_ACTIVE: 'prod',
  TZ: 'America/Argentina/Buenos_Aires',
  AUTH_JWT_TTL_DAYS: '7',
  GOOGLE_CLIENT_ID: 'test-client-id',
  GOOGLE_CLIENT_SECRET: 'test-client-secret',
  GOOGLE_REDIRECT_URI: 'http://localhost:8080/api/v1/auth/callback',
  AUTH_ALLOWED_DOMAINS: 'itba.edu.ar',
  AUTH_ALLOWED_EMAILS: 'external@gmail.com',
  AUTH_SYNC_API_KEY: 'dropin-sync-key',
  REVIEW_LOGIN_EMAIL: REVIEW_EMAIL,
  REVIEW_LOGIN_PASSWORD_HASH: bcrypt.hashSync(REVIEW_PASSWORD, 4),
  ITBA_API_USE_FAKE: 'true',
  RATE_LIMIT_ENABLED: 'false',
  KB_LLM_USE_FAKE: 'true',
  KB_EMBEDDING_USE_FAKE: 'true',
  KB_EMBEDDINGS_ENABLED: 'false',
  KB_PIPELINE_BACKGROUND: 'false',
  MAIL_LOG_SENDS: 'true',
  DIGEST_JOBS_ENABLED: 'false',
  DIGEST_SEND_INTERVAL: 'PT0S',
  EVENT_REMINDERS_ENABLED: 'false',
  ORG_MAIL_JOBS_ENABLED: 'false',
  DRIVE_SYNC_ENABLED: 'false',
  SYNC_ENABLED: 'false',
  LOGGING_LEVEL_ROOT: 'WARN',
  LOGGING_LEVEL_ORG_CEITBA_API: 'WARN',
  LOG_LEVEL: 'warn',
};

const pgUrl = (db: string) => { const u = new URL(PG); u.pathname = `/${db}`; return u.toString(); };
const connect = (db: string, max = 4): Sql => postgres(pgUrl(db), { max, onnotice: () => {} });

// ------------------------------------------------------------------ identities

const B = '00000000-0000-4000-8000-00000000b001'; // bench@itba.edu.ar (load.ts), the normal user
const U = (n: number) => `00000000-0000-4000-9000-${n.toString(16).padStart(12, '0')}`;
const STAFF2 = '00000000-0000-4000-8000-00000000d001';
const ORG = 'bench-org-6'; // U(5) is its admin (load.ts: n % 5 == 0)
const key = (label: string) => `ceitba_${createHash('sha256').update(`dropin-key:${label}`).digest('base64url')}`;
const sha256Hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const KEYS = { staffFull: key('staff-full'), userRead: key('user-read'), userFull: key('user-full'), expired: key('expired') };
const RT = (label: string) => createHash('sha256').update(`dropin-rt:${label}`).digest('base64url');
const TRACK = Buffer.from('dropinTrackB1AAA').toString('base64url'); // a tracking id: base64url of 16 bytes
const SHARE_TOKEN = Buffer.from('dropinShareToken01').toString('base64url');
const id = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const P = (n: number) => id('a0000000', n);
const G = (n: number) => id('b0000000', n);
const DG = (n: number) => id('c0000000', n);
const KB = (n: number) => id('d0000000', n);
const DS = (n: number) => id('e0000000', n);
const W = (n: number) => id('f0000000', n);

function mintJwt(sub: string, email: string, name: string | null): string {
  const b64u = (s: string) => Buffer.from(s).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = { aud: 'ceitba-api', sub, iss: 'https://ceitba.org.ar/api' };
  if (name) payload.name = name;
  Object.assign(payload, { exp: now + 6 * 3600, iat: now, jti: crypto.randomUUID(), email });
  const h = b64u(JSON.stringify({ alg: 'HS256' }));
  const p = b64u(JSON.stringify(payload));
  return `${h}.${p}.${createHmac('sha256', Buffer.from(SECRETS.AUTH_JWT_SECRET, 'base64')).update(`${h}.${p}`).digest('base64url')}`;
}

// ------------------------------------------------------------------ seed

function seedSql(): string {
  const mail = new MailTokenCipher(SECRETS.MAIL_TOKEN_ENCRYPTION_KEY);
  const kb = new KbSecretCipher(SECRETS.KB_SECRETS_KEY, SECRETS.AUTH_JWT_SECRET);
  const ceitbaEnc = mail.encrypt('1//refresh-token-ceitba-newsletter', 'newsletter@ceitba.org.ar');
  const orgEnc = mail.encrypt('1//refresh-token-org6', 'org6.mail@gmail.com');
  const kbKey = kb.encrypt('sk-dropin-endpoint-key');
  return String.raw`
BEGIN;
-- Identities beyond load.ts: a second staff member (IT MEMBER), an expired one, moderators, the review account.
INSERT INTO "user" (id, email, name, career_id, plan, file_number, created_at, updated_at, preferred_language, theme,
                    linkedin, instagram, discord, avatar_url, digest_email_enabled, google_sub)
VALUES ('${STAFF2}', 'staff2@itba.edu.ar', 'Staff Dos', 'S', 'BP-S-1', 61234, now() - interval '300 days', now(), 'en', 'dark',
        'https://www.linkedin.com/in/staff2', 'staff2ig', 'staff2#1', 'https://lh3.googleusercontent.com/a/staff2', false, '1000000000000000001');
UPDATE "user" SET theme = 'light', linkedin = 'https://www.linkedin.com/in/bench', instagram = 'bench.itba', discord = 'bench#0001',
                  avatar_url = 'https://lh3.googleusercontent.com/a/bench', google_sub = '1000000000000000002', digest_email_enabled = true
 WHERE id = '${B}';
UPDATE "user" SET preferred_language = NULL, theme = NULL WHERE id = '${U(3)}';
INSERT INTO ceitba_staff (user_id, branch, role, start, "end") VALUES
  ('${STAFF2}', 'IT', 'MEMBER', now() - interval '200 days', now() + interval '165 days'),
  ('${U(7)}', 'MEDIA', 'LEADER', now() - interval '800 days', now() - interval '400 days');
INSERT INTO ceitba_moderators (user_id, granted_by, granted_at, revoked_at, revoked_by) VALUES
  ('${U(10)}', (SELECT id FROM "user" WHERE email = 'ceitba@itba.edu.ar'), now() - interval '30 days', NULL, NULL),
  ('${U(11)}', '${STAFF2}', now() - interval '90 days', now() - interval '10 days', '${STAFF2}');

-- API keys (scopes csv like ApiKeyService), refresh tokens (one rotated family, one revoked), devices.
INSERT INTO api_keys (id, user_id, name, key_hash, created_at, expires_at, last_used_at, scopes) VALUES
  ('${W(1)}', (SELECT id FROM "user" WHERE email = 'ceitba@itba.edu.ar'), 'staff cli', '${sha256Hex(KEYS.staffFull)}', now() - interval '5 days', now() + interval '25 days', NULL, 'read,report,write,staff,keys'),
  ('${W(2)}', '${B}', 'mcp read', '${sha256Hex(KEYS.userRead)}', now() - interval '3 days', now() + interval '87 days', now() - interval '1 day', 'read'),
  ('${W(3)}', '${B}', 'scripts', '${sha256Hex(KEYS.userFull)}', now() - interval '40 days', now() + interval '50 days', NULL, 'read,report,write,staff,keys'),
  ('${W(4)}', '${B}', 'old', '${sha256Hex(KEYS.expired)}', now() - interval '100 days', now() - interval '10 days', now() - interval '20 days', 'read,report');
INSERT INTO refresh_tokens (id, user_id, family_id, token_hash, device_name, created_at, expires_at, revoked_at, replaced_by) VALUES
  ('${W(11)}', '${B}', '${W(10)}', '${sha256Hex(RT('rt-1'))}', 'iPhone 15', now() - interval '3 days', now() + interval '57 days', now() - interval '2 days', '${W(12)}'),
  ('${W(12)}', '${B}', '${W(10)}', '${sha256Hex(RT('rt-2'))}', 'iPhone 15', now() - interval '2 days', now() + interval '58 days', NULL, NULL),
  ('${W(13)}', '${U(2)}', '${W(14)}', '${sha256Hex(RT('rt-3'))}', NULL, now() - interval '70 days', now() - interval '10 days', NULL, NULL);
INSERT INTO user_devices (token, user_id, platform, app_version, created_at, last_seen_at) VALUES
  ('fcm-token-bench-ios', '${B}', 'ios', '2.3.1', now() - interval '20 days', now() - interval '1 day'),
  ('fcm-token-u2-android', '${U(2)}', 'android', NULL, now() - interval '5 days', now());
INSERT INTO deleted_firebase_accounts (firebase_uid_sha256, deleted_at) VALUES ('${sha256Hex('firebase-uid-gone')}', now() - interval '60 days');

-- Capabilities, highlights, benefit cards, staff members.
INSERT INTO capability_settings (capability, enabled_for_all, updated_at, updated_by) VALUES ('apuntes', false, now() - interval '9 days', '${STAFF2}');
INSERT INTO capability_org_grants (capability, org_slug, granted_at, granted_by) VALUES ('apuntes', '${ORG}', now() - interval '8 days', '${STAFF2}');
INSERT INTO capability_user_grants (capability, email) VALUES ('apuntes', 'staff2@itba.edu.ar');
INSERT INTO capability_user_grants (capability, email)
SELECT c, u.email FROM unnest(ARRAY['apuntes','resumen_semanal']) c, "user" u
 WHERE u.id IN ('${B}', '${U(2)}', '${U(20)}', '${U(21)}', '${U(22)}', '${U(23)}', '${U(24)}', '${U(30)}', '${U(31)}')
ON CONFLICT DO NOTHING;
INSERT INTO home_highlights (id, title, description, image_url, link_url, position, starts_at, ends_at, active, created_at, updated_at) VALUES
  ('${W(20)}', 'Semana de la ingeniería', 'Charlas y talleres', 'https://ceitba.org.ar/img/h1.png', 'https://ceitba.org.ar/eventos', 0, now() - interval '2 days', now() + interval '5 days', true, now() - interval '3 days', now()),
  ('${W(21)}', 'Inscripciones', NULL, 'https://ceitba.org.ar/img/h2.png', NULL, 1, NULL, NULL, true, now() - interval '30 days', now() - interval '30 days'),
  ('${W(22)}', 'Futuro', 'Todavía no', 'https://ceitba.org.ar/img/h3.png', NULL, 2, now() + interval '10 days', NULL, true, now(), now()),
  ('${W(23)}', 'Inactivo', NULL, 'https://ceitba.org.ar/img/h4.png', NULL, 3, NULL, NULL, false, now(), now());
INSERT INTO benefit_cards (id, category_slug, display_order, title_es, title_en, summary_es, summary_en, image_url, cta_url, cta_label_es, cta_label_en,
                           price, bullets_es, bullets_en, created_at, updated_at, location, location_url, phone, website, email) VALUES
  ('${W(30)}', 'convenios', 0, 'Gimnasio', 'Gym', '20% off', '20% off', 'https://ceitba.org.ar/img/gym.png', 'https://gym.example', 'Ver', 'See',
   '$ 15.000', ARRAY['Pileta','Sauna'], ARRAY['Pool','Sauna'], now() - interval '50 days', now() - interval '2 days', 'Av. Madero 399', 'https://maps.example/x', '+54 11 5555-5555', 'https://gym.example', 'gym@example.com'),
  ('${W(31)}', 'convenios', 1, 'Librería', 'Bookstore', '', '', NULL, NULL, NULL, NULL, NULL, ARRAY[]::text[], ARRAY[]::text[], now(), now(), NULL, NULL, NULL, NULL, NULL),
  ('${W(32)}', 'idiomas', 0, 'Inglés', 'English', 'Clases', 'Classes', NULL, NULL, NULL, NULL, '0.5', ARRAY['A1'], ARRAY['A1'], now(), now(), NULL, NULL, NULL, NULL, NULL);
INSERT INTO staff_members (id, year, department_slug, display_order, name, role_es, role_en, photo_url, linkedin_url, email, created_at, updated_at) VALUES
  ('${W(40)}', 2026, 'it', 0, 'Ana IT', 'Coordinadora', 'Coordinator', 'https://ceitba.org.ar/img/ana.png', 'https://www.linkedin.com/in/ana', 'ana@itba.edu.ar', now(), now()),
  ('${W(41)}', 2026, 'it', 1, 'Beto IT', 'Miembro', 'Member', NULL, NULL, NULL, now(), now()),
  ('${W(42)}', 2026, 'media', 0, 'Caro Media', 'Líder', 'Lead', NULL, NULL, NULL, now(), now()),
  ('${W(43)}', 2025, 'directivos', 0, 'Dani', 'Presidente', 'President', NULL, NULL, NULL, now() - interval '400 days', now() - interval '400 days');

-- Org: invites, mail opt-outs, a member with a title, announcements (one sent with deliveries, one draft).
INSERT INTO org_invites (org_slug, email, role, invited_by, created_at) VALUES
  ('${ORG}', 'invitee@itba.edu.ar', 'member', '${U(5)}', now() - interval '2 days'),
  ('${ORG}', 'coadmin@itba.edu.ar', 'admin', '${U(5)}', now() - interval '1 day');
INSERT INTO org_mail_optouts (user_id, org_slug, created_at) VALUES ('${U(12)}', '${ORG}', now() - interval '4 days');
INSERT INTO user_follows (user_id, org_slug, created_at) VALUES ('${B}', '${ORG}', now() - interval '10 days') ON CONFLICT DO NOTHING;
INSERT INTO mail_sender_account (email, owner_type, owner_ref, refresh_token_enc, scopes, status, connected_by, connected_at, last_error, last_used_at) VALUES
  ('newsletter@ceitba.org.ar', 'ceitba', NULL, '${ceitbaEnc}', 'https://www.googleapis.com/auth/gmail.send', 'connected', '${STAFF2}', now() - interval '60 days', NULL, now() - interval '7 days'),
  ('org6.mail@gmail.com', 'organization', '${ORG}', '${orgEnc}', 'https://www.googleapis.com/auth/gmail.send', 'connected', '${U(5)}', now() - interval '20 days', NULL, now() - interval '6 days');
INSERT INTO mail_account_state (account, paused_until, pause_reason, consecutive_failures, updated_at) VALUES
  ('newsletter@ceitba.org.ar', NULL, NULL, 0, now() - interval '7 days'),
  ('org6.mail@gmail.com', now() - interval '1 day', 'quota', 2, now() - interval '2 days');
INSERT INTO mail_send_log (account, kind, recipients, outcome, error, attempted_at) VALUES
  ('newsletter@ceitba.org.ar', 'digest', 1, 'sent', NULL, now() - interval '7 days'),
  ('newsletter@ceitba.org.ar', 'digest', 1, 'sent', NULL, now() - interval '7 days'),
  ('org6.mail@gmail.com', 'org-announcement', 3, 'sent', NULL, now() - interval '6 days'),
  ('org6.mail@gmail.com', 'org-announcement', 1, 'quota', 'Daily sending quota exceeded', now() - interval '2 days');
INSERT INTO org_announcements (org_slug, subject, body, status, sender_email, recipient_count, created_by, created_at, sent_at, finished_at) VALUES
  ('${ORG}', 'Reunión general', E'Hola!\n\nNos juntamos el jueves.', 'sent', 'org6.mail@gmail.com', 3, '${U(5)}', now() - interval '7 days', now() - interval '6 days', now() - interval '6 days'),
  ('${ORG}', 'Borrador', 'Texto', 'draft', NULL, NULL, '${U(5)}', now() - interval '1 day', NULL, NULL);
INSERT INTO org_announcement_deliveries (announcement_id, user_id, email, status, attempts, last_error, claimed_at, sent_at)
SELECT a.id, u.id, u.email, 'sent', 1, NULL, now() - interval '6 days', now() - interval '6 days'
FROM org_announcements a, "user" u WHERE a.status = 'sent' AND u.id IN ('${U(1)}', '${U(2)}', '${U(3)}');
INSERT INTO push_log (org_slug, kind, ref_id, targeted, sent, created_at) VALUES
  ('${ORG}', 'article', 'bench-art-0006', 120, 118, now() - interval '3 days'),
  (NULL, 'broadcast', NULL, 5000, 4870, now() - interval '9 days'),
  ('${ORG}', 'event', 'bench-evt-0033', 40, 40, now() - interval '1 day');
INSERT INTO analytics_events (type, session_id, ts, article_id, category, path, ip_hash, event_id)
SELECT (ARRAY['page_view','article_view','category_view','event_view'])[1 + n % 4], 's' || (n % 37), now() - (n || ' hours')::interval,
       CASE WHEN n % 4 = 1 THEN 'bench-art-' || lpad((1 + n % 50)::text, 4, '0') END, CASE WHEN n % 4 = 2 THEN 'Cultura' END,
       '/newsletter', md5(n::text), CASE WHEN n % 4 = 3 THEN 'bench-evt-' || lpad((3 + 30 * (n % 5))::text, 4, '0') END
FROM generate_series(1, 400) n;

-- Proposals: approved/open by the user, pending, rejected, accepted; aliases, comments (a reply, a deleted one),
-- votes, an attachment.
INSERT INTO proposal (id, author_id, title, description, topic, status, lifecycle, rejection_reason, moderated_by, moderated_at, created_at, updated_at, up_count, down_count, comment_count) VALUES
  ('${P(1)}', '${B}', 'Microondas en el SDF', 'Más microondas en el comedor del SDF.', 'VIDA_UNIVERSITARIA', 'APPROVED', 'ABIERTO', NULL, '${STAFF2}', now() - interval '9 days', now() - interval '10 days', now() - interval '9 days', 2, 1, 2),
  ('${P(2)}', '${U(2)}', 'Torneo de ajedrez', 'Un torneo por cuatrimestre.', 'EVENTOS', 'PENDING', 'ABIERTO', NULL, NULL, NULL, now() - interval '2 days', now() - interval '2 days', 0, 0, 0),
  ('${P(3)}', '${U(3)}', 'Spam', 'compren', 'OTROS', 'REJECTED', 'CERRADO', 'Fuera de tema', '${STAFF2}', now() - interval '4 days', now() - interval '5 days', now() - interval '4 days', 0, 0, 0),
  ('${P(4)}', '${U(4)}', 'Curso de LaTeX', 'Un curso introductorio.', 'CURSOS', 'APPROVED', 'ACEPTADO', NULL, '${STAFF2}', now() - interval '30 days', now() - interval '31 days', now() - interval '3 days', 1, 0, 0);
INSERT INTO proposal_alias (proposal_id, user_id, alias, created_at) VALUES
  ('${P(1)}', '${B}', 'Carpincho Azul', now() - interval '10 days'), ('${P(1)}', '${U(2)}', 'Hornero Rojo', now() - interval '8 days'),
  ('${P(1)}', '${U(3)}', 'Yaguareté Verde', now() - interval '7 days'), ('${P(2)}', '${U(2)}', 'Ñandú Gris', now() - interval '2 days'),
  ('${P(3)}', '${U(3)}', 'Tero Negro', now() - interval '5 days'), ('${P(4)}', '${U(4)}', 'Puma Dorado', now() - interval '31 days');
INSERT INTO proposal_comment (id, proposal_id, author_id, parent_id, body, created_at, deleted_at) VALUES
  ('${P(11)}', '${P(1)}', '${U(2)}', NULL, 'Totalmente de acuerdo', now() - interval '8 days', NULL),
  ('${P(12)}', '${P(1)}', '${B}', '${P(11)}', '¡Gracias!', now() - interval '7 days 23 hours', NULL),
  ('${P(13)}', '${P(1)}', '${U(3)}', NULL, NULL, now() - interval '7 days', now() - interval '6 days');
INSERT INTO proposal_vote (proposal_id, user_id, value, created_at, updated_at) VALUES
  ('${P(1)}', '${U(2)}', 'UP', now() - interval '8 days', now() - interval '8 days'), ('${P(1)}', '${B}', 'UP', now() - interval '9 days', now() - interval '9 days'),
  ('${P(1)}', '${U(3)}', 'DOWN', now() - interval '7 days', now() - interval '6 days'), ('${P(4)}', '${B}', 'UP', now() - interval '20 days', now() - interval '20 days');
INSERT INTO proposal_attachment (proposal_id, position, object_key, content_type) VALUES
  ('${P(1)}', 0, 'proposals/${P(1)}/microondas.png', 'image/png'), ('${P(1)}', 1, 'proposals/${P(1)}/plano.pdf', 'application/pdf');

-- Study groups and a share session (with the participants' saved schedules).
INSERT INTO study_groups (id, owner_id, title, subject_id, type, locations, due_at, description, contact_link, max_participants, created_at, updated_at) VALUES
  ('${G(1)}', '${B}', 'TP Algoritmos', 'B0001', 'TP_GRUPO', ARRAY['VIRTUAL','SDF'], now() + interval '10 days', 'Buscamos 2 más', 'https://chat.whatsapp.com/x', 4, now() - interval '3 days', now() - interval '1 day'),
  ('${G(2)}', '${U(2)}', 'Final de Física', 'B0002', 'EXAMEN', ARRAY['SDT'], now() - interval '2 days', NULL, NULL, NULL, now() - interval '20 days', now() - interval '20 days'),
  ('${G(3)}', '${U(3)}', 'Guías de Análisis', 'B0001', 'GUIAS', ARRAY['SDR','VIRTUAL'], now() + interval '30 days', 'Todos los jueves', NULL, 10, now() - interval '1 day', now() - interval '1 day');
INSERT INTO study_group_participants (group_id, user_id, joined_at) VALUES
  ('${G(1)}', '${B}', now() - interval '3 days'), ('${G(1)}', '${U(2)}', now() - interval '2 days'),
  ('${G(2)}', '${U(2)}', now() - interval '20 days'), ('${G(2)}', '${B}', now() - interval '19 days'), ('${G(3)}', '${U(3)}', now() - interval '1 day');
INSERT INTO share_sessions (id, token, creator_user_id, name, expires_at, created_at, updated_at) VALUES
  ('${G(11)}', '${SHARE_TOKEN}', '${B}', 'Armado 2C', now() + interval '6 days', now() - interval '1 day', now() - interval '1 day');
INSERT INTO share_session_participants (session_id, user_id, saved_schedule_id, display_name, joined_at)
SELECT '${G(11)}', s.user_id, s.id, CASE WHEN s.user_id = '${B}' THEN 'Bench' ELSE 'Usuario' END, now() - interval '20 hours'
FROM saved_schedules s WHERE s.is_primary AND s.user_id IN ('${B}', (SELECT id FROM "user" WHERE email = 'bench1@itba.edu.ar'));

-- Digests: last week's (sent, with a tracked delivery, links and an open) and this week's draft.
INSERT INTO digest_issues (id, week_start, subject, intro, excluded_article_ids, excluded_event_ids, status, auto_send_at, sent_at, sent_by, created_at, updated_at) VALUES
  ('${DG(1)}', date_trunc('week', current_date)::date - 7, 'Novedades de la semana', 'Hola! Esto pasó.', ARRAY['bench-art-0003'], ARRAY[]::text[], 'sent', NULL, now() - interval '5 days', '${STAFF2}', now() - interval '9 days', now() - interval '5 days'),
  ('${DG(2)}', date_trunc('week', current_date)::date, 'Semana en curso', NULL, ARRAY[]::text[], ARRAY['bench-evt-0333'], 'draft', now() + interval '2 days', NULL, NULL, now() - interval '2 days', now() - interval '1 day');
INSERT INTO digest_issue_links (issue_id, link_id, url, url_key, label) VALUES
  ('${DG(1)}', 1, 'https://ceitba.org.ar/newsletter/articles/bench-art-0001', 'ceitba.org.ar/newsletter/articles/bench-art-0001', 'Artículo 1'),
  ('${DG(1)}', 2, 'https://ceitba.org.ar/eventos', 'ceitba.org.ar/eventos', 'Eventos');
INSERT INTO digest_deliveries (issue_id, user_id, email, status, error, sent_at, claimed_at, attempts, last_error, tracking_id, first_opened_at, last_opened_at, open_count, first_clicked_at, click_count) VALUES
  ('${DG(1)}', '${B}', 'bench@itba.edu.ar', 'sent', NULL, now() - interval '5 days', now() - interval '5 days', 1, NULL, '${TRACK}', now() - interval '4 days', now() - interval '3 days', 2, NULL, 0),
  ('${DG(1)}', '${U(2)}', 'bench2@itba.edu.ar', 'failed', 'bounced', NULL, now() - interval '5 days', 3, 'bounced', NULL, NULL, NULL, 0, NULL, 0);
INSERT INTO digest_delivery_links (tracking_id, link_id, url, url_key, label) VALUES
  ('${TRACK}', 1, 'https://ceitba.org.ar/newsletter/articles/bench-art-0001', 'ceitba.org.ar/newsletter/articles/bench-art-0001', 'Artículo 1'),
  ('${TRACK}', 2, 'https://ceitba.org.ar/eventos', 'ceitba.org.ar/eventos', 'Eventos');
INSERT INTO mail_tracking_event (tracking_id, type, link_id, at, flagged, flag_reason, ua_class) VALUES
  ('${TRACK}', 'open', NULL, now() - interval '4 days', false, NULL, 'human'),
  ('${TRACK}', 'open', NULL, now() - interval '3 days', true, 'prefetch', 'proxy');

-- Drive: the user's own source (ACTIVE) with files in every publication state, a pending source, reports.
INSERT INTO wiki.drive_source (id, user_id, root_folder_id, root_name, status, anonymous, consent_version, consented_at, approved_at, reviewed_by, reviewed_at,
                               last_synced_at, consecutive_failures, created_at, updated_at, kind, display_name, storage_mode, subject_id, owner_email) VALUES
  ('${DS(1)}', '${B}', 'drive-folder-bench', 'Mis apuntes', 'ACTIVE', false, 'v1', now() - interval '40 days', now() - interval '39 days', '${STAFF2}', now() - interval '39 days',
   now() - interval '1 day', 0, now() - interval '40 days', now() - interval '1 day', 'STUDENT', NULL, 'COPY', 'B0001', 'bench@itba.edu.ar'),
  ('${DS(2)}', '${U(3)}', 'drive-folder-u3', 'Apuntes U3', 'PENDING_REVIEW', true, 'v1', now() - interval '2 days', NULL, NULL, NULL,
   NULL, 0, now() - interval '2 days', now() - interval '2 days', 'STUDENT', NULL, 'REFERENCE', NULL, 'bench3@itba.edu.ar');
INSERT INTO wiki.drive_file (id, source_id, drive_id, name, mime_type, kind, subject_id, effective_subject_id, publication, published_at, size_bytes, drive_modified_at, text_content, academic_year)
VALUES ('${DS(11)}', '${DS(1)}', 'bench-own-1', 'Resumen parcial.pdf', 'application/pdf', 'PDF', 'B0001', 'B0001', 'PUBLISHED', now() - interval '30 days', 2048, now() - interval '31 days', 'resumen', 2025),
       ('${DS(12)}', '${DS(1)}', 'bench-own-2', 'Borrador.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'OFFICE', 'B0001', 'B0001', 'NEEDS_REVIEW', NULL, 999, now() - interval '3 days', NULL, NULL),
       ('${DS(13)}', '${DS(1)}', 'bench-own-3', 'Privado.pdf', 'application/pdf', 'PDF', NULL, NULL, 'PRIVATE', NULL, 10, now() - interval '3 days', NULL, NULL);
INSERT INTO wiki.drive_file_report (file_id, user_id, reason, comment, created_at)
SELECT id, '${U(2)}', 'COPYRIGHT', 'Es de un libro', now() - interval '1 day' FROM wiki.drive_file WHERE drive_id = 'bench-df-1';
INSERT INTO wiki.drive_unclaimed_share (drive_id, name, owner_email, first_seen_at, last_seen_at) VALUES ('unclaimed-1', 'Carpeta suelta', 'someone@itba.edu.ar', now() - interval '3 days', now());
INSERT INTO wiki.drive_source_walk (source_id, generation, started_at, completed_at, frontier, root_ancestors, incomplete, warning, updated_at)
VALUES ('${DS(1)}', 3, now() - interval '1 day', now() - interval '1 day', '[]'::jsonb, '[]'::jsonb, false, NULL, now() - interval '1 day');

-- Legacy subject wiki (notes, comments, votes, difficulty, edit proposals, bookmarks) and career notes.
INSERT INTO wiki.subject_wiki_page (subject_id, content, updated_by, updated_at, created_at) VALUES ('B0001', E'# Algoritmos\n\nBibliografía y consejos.', '${B}', now() - interval '12 days', now() - interval '100 days');
INSERT INTO wiki.subject_note (id, subject_id, owner_name, link, uploader_id, created_at, updated_at) VALUES ('${W(50)}', 'B0001', 'Bench', 'https://drive.google.com/x', '${B}', now() - interval '50 days', now() - interval '50 days');
INSERT INTO wiki.subject_note_vote (note_id, user_id, type) VALUES ('${W(50)}', '${U(2)}', 'LIKE');
INSERT INTO wiki.subject_comment (id, subject_id, user_id, content, created_at, updated_at) VALUES ('${W(51)}', 'B0001', '${U(2)}', 'Muy buena materia', now() - interval '40 days', now() - interval '40 days');
INSERT INTO wiki.subject_comment_vote (comment_id, user_id, type) VALUES ('${W(51)}', '${B}', 'DISLIKE');
INSERT INTO wiki.subject_difficulty (subject_id, user_id, value, created_at, updated_at) VALUES ('B0001', '${B}', 4, now() - interval '40 days', now() - interval '40 days');
INSERT INTO wiki.subject_wiki_edit_proposal (id, subject_id, proposed_by, proposed_at, proposed_content, status, reviewed_by, reviewed_at, review_comment)
VALUES ('${W(52)}', 'B0001', '${U(2)}', now() - interval '20 days', 'Nuevo contenido', 'PENDING', NULL, NULL, NULL);
INSERT INTO wiki.career_note (id, career_id, name, owner_name, link, uploader_id, created_at, updated_at) VALUES ('${W(53)}', 'S', 'Plan de estudios', 'Bench', 'https://x.example', '${B}', now() - interval '60 days', now() - interval '60 days');
INSERT INTO wiki.career_note_vote (note_id, user_id, type) VALUES ('${W(53)}', '${U(4)}', 'LIKE');
INSERT INTO wiki.subject_bookmarks (subject_id, user_id, updated_at) VALUES ('B0001', '${B}', now() - interval '6 days'), ('B0002', '${B}', now() - interval '5 days'), ('B0001', '${U(2)}', now() - interval '4 days');

-- KB admin: an endpoint (encrypted key), runs, usage, a page report and revision, price history, settings, an eval set/eval/rating.
INSERT INTO wiki.kb_llm_endpoint (id, name, base_url, api_key_encrypted, max_concurrency, timeout_sec, enabled, created_by, created_at, updated_by, updated_at)
VALUES ('${KB(1)}', 'Local vLLM', 'http://vllm.internal:8000/v1', '${kbKey}', 4, 120, true, '${STAFF2}', now() - interval '15 days', '${STAFF2}', now() - interval '14 days');
INSERT INTO wiki.kb_run (id, subject_id, status, generator, stats, error, started_at, finished_at, trigger, stage, dry_run, prompt_version, model, subjects,
                         tokens_in, tokens_out, tokens_cached, estimated_tokens, cost_estimate, updated_at, cost_approved, expected_cost_usd, simulated, stage_log, resume_count) VALUES
  ('${KB(10)}', NULL, 'SUCCEEDED', 'pipeline', '{"pages":11}'::jsonb, NULL, now() - interval '3 days', now() - interval '3 days' + interval '40 minutes', 'SCHEDULED', 'DONE', false, 'v7', 'glm-5.3',
   '["B0001","B0002"]'::jsonb, 120000, 45000, 10000, 170000, 0.4231, now() - interval '3 days', true, 0.45, false, '{}'::jsonb, 0),
  ('${KB(11)}', 'B0003', 'FAILED', 'pipeline', '{}'::jsonb, 'LLM timeout', now() - interval '1 day', now() - interval '1 day' + interval '5 minutes', 'MANUAL', 'WRITE', false, 'v7', 'glm-5.3-flash',
   '["B0003"]'::jsonb, 5000, 0, 0, 9000, 0.01, now() - interval '1 day', true, 0.02, false, '{}'::jsonb, 1);
INSERT INTO wiki.kb_run_subject (run_id, subject_id, status, model, priority, inputs, tokens_in, tokens_out, tokens_cached, cost_estimate, error)
VALUES ('${KB(10)}', 'B0001', 'PUBLISHED', 'glm-5.3', 1, '{"files":[]}'::jsonb, 60000, 22000, 5000, 0.2, NULL),
       ('${KB(10)}', 'B0002', 'PUBLISHED', 'glm-5.3', 2, '{"files":[]}'::jsonb, 60000, 23000, 5000, 0.22, NULL);
INSERT INTO wiki.kb_llm_usage (created_at, run_id, request_id, model, mode, stage, subject_id, input_tokens, cached_input_tokens, output_tokens, cost_usd, simulated, attempt, latency_ms, reasoning_tokens)
SELECT now() - (n || ' hours')::interval, '${KB(10)}', 'req-' || n, (ARRAY['glm-5.3','glm-5.3-flash'])[1 + n % 2], (ARRAY['BATCH','SYNC'])[1 + n % 2],
       (ARRAY['DIGEST','PLAN','WRITE'])[1 + n % 3], 'B000' || (1 + n % 2), 1000 + n, n, 300 + n, 0.001 * n, false, 1, 900 + n, 0
FROM generate_series(1, 60) n;
INSERT INTO wiki.kb_model_price_history (model_id, field, old_value, new_value, changed_at, source) VALUES ('glm-5.3', 'input_price', '0.5', '0.45', now() - interval '20 days', 'catalog');
INSERT INTO wiki.kb_pipeline_settings (id, settings, updated_by, updated_at) VALUES (1, '{"weeklyBudgetUsd": 5}'::jsonb, '${STAFF2}', now() - interval '6 days');
INSERT INTO wiki.kb_pipeline_settings_history (id, settings, changed_by, changed_at, note) VALUES ('${KB(20)}', '{"weeklyBudgetUsd": 5}'::jsonb, '${STAFF2}', now() - interval '6 days', 'budget');
INSERT INTO wiki.kb_page_report (page_id, user_id, reason, comment, created_at)
SELECT id, '${U(2)}', 'CONTENT_ERROR', 'La fórmula está mal', now() - interval '2 days' FROM wiki.kb_page WHERE subject_id = 'B0001' AND slug = 'tema-01';
INSERT INTO wiki.kb_page_revision (page_id, revision, type, title, summary, aliases, markdown, sources, generator, generated_at, created_at)
SELECT id, 0, type, title, summary, ARRAY[]::text[], markdown, sources, generator, generated_at - interval '7 days', now() - interval '7 days' FROM wiki.kb_page WHERE subject_id = 'B0001' AND slug = 'tema-02';
INSERT INTO wiki.kb_eval_set (id, name, subject_ids, created_by, created_at, frozen_inputs, frozen_at)
VALUES ('${KB(30)}', 'Primer año', '["B0001","B0002"]'::jsonb, '${STAFF2}', now() - interval '12 days', NULL, NULL);
INSERT INTO wiki.kb_run (id, status, generator, started_at, finished_at, trigger, stage, dry_run, model, subjects, updated_at, cost_approved)
VALUES ('${KB(31)}', 'SUCCEEDED', 'eval', now() - interval '11 days', now() - interval '11 days', 'EVAL', 'DONE', false, 'glm-5.3', '["B0001","B0002"]'::jsonb, now() - interval '11 days', true);
INSERT INTO wiki.kb_eval (id, set_id, configs, note, results, created_by, created_at, finished_at)
VALUES ('${KB(31)}', '${KB(30)}', '[{"configKey":"a","plan":"glm-5.3","write":"glm-5.3"},{"configKey":"b","plan":"glm-5.3","write":"glm-5.3-flash"}]'::jsonb,
        'flash vs full', '{"configs":{}}'::jsonb, '${STAFF2}', now() - interval '11 days', now() - interval '11 days');
COMMIT;
ANALYZE;
`;
}

// ------------------------------------------------------------------ servers

interface Srv { name: string; base: string; stop(): Promise<void>; log: string }

async function startServer(kind: 'java' | 'bun', port: number, db: string, extra: Record<string, string> = {}): Promise<Srv> {
  const u = new URL(PG);
  const env = {
    PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...SERVER_ENV, ...extra, PORT: String(port),
    DATABASE_URL: `jdbc:postgresql://${u.hostname}:${u.port || 5432}/${db}`,
    POSTGRES_USER: decodeURIComponent(u.username), POSTGRES_PASSWORD: decodeURIComponent(u.password),
  };
  const log = join(OUT, `${kind}-${db}-${port}.log`);
  const fd = openSync(log, 'w');
  const cmd = kind === 'java'
    ? [join(JAVA_HOME, 'bin', 'java'), '-Duser.language=en', '-Duser.country=US', '-jar', JAR]
    : [process.execPath, 'src/main.ts'];
  const proc = Bun.spawn(cmd, { env, cwd: API_DIR, stdout: fd, stderr: fd });
  const base = `http://127.0.0.1:${port}/api`;
  const t0 = performance.now();
  for (;;) {
    if (proc.exitCode !== null) throw new Error(`${kind} exited ${proc.exitCode}: ${readFileSync(log, 'utf8').slice(-3000)}`);
    const ok = await fetch(`${base}/actuator/health/readiness`, { signal: AbortSignal.timeout(2000) }).then((r) => r.status === 200, () => false);
    if (ok) break;
    if (performance.now() - t0 > 180_000) { proc.kill('SIGKILL'); throw new Error(`${kind} not ready: ${readFileSync(log, 'utf8').slice(-3000)}`); }
    await Bun.sleep(200);
  }
  console.error(`${kind} on ${db} ready in ${Math.round(performance.now() - t0)} ms (${base})`);
  return {
    name: kind, base, log,
    async stop() {
      proc.kill('SIGTERM');
      await Promise.race([proc.exited, Bun.sleep(15_000)]);
      if (proc.exitCode === null) proc.kill('SIGKILL');
    },
  };
}

// ------------------------------------------------------------------ requests

type Auth = { bearer: string } | { cookie: string } | { apiKey: string } | null;
interface Req { method: string; path: string; auth?: Auth; body?: unknown; headers?: Record<string, string> }
interface Res { status: number; headers: Record<string, string>; cookies: string[]; text: string; json?: any }

const COMPARED_HEADERS = ['content-type', 'cache-control', 'location', 'www-authenticate', 'content-disposition', 'allow', 'vary',
  'pragma', 'expires', 'x-content-type-options', 'x-frame-options', 'x-xss-protection', 'retry-after', 'accept'];

async function send(s: Srv, r: Req): Promise<Res> {
  const headers = new Headers(r.headers ?? {});
  const a = r.auth;
  if (a && 'bearer' in a) headers.set('Authorization', `Bearer ${a.bearer}`);
  if (a && 'cookie' in a) headers.set('Cookie', `ceitba_session=${a.cookie}`);
  if (a && 'apiKey' in a) headers.set('X-Api-Key', a.apiKey);
  let body: string | undefined;
  if (r.body !== undefined) { body = typeof r.body === 'string' ? r.body : JSON.stringify(r.body); if (!headers.has('content-type')) headers.set('Content-Type', 'application/json'); }
  const res = await fetch(s.base + r.path, { method: r.method, headers, body, redirect: 'manual' });
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get('content-type') ?? '';
  const text = /json|text|xml|html|javascript/.test(ct) || buf.length === 0 ? buf.toString('utf8') : `<${buf.length} bytes sha256 ${createHash('sha256').update(buf).digest('hex').slice(0, 16)}>`;
  const h: Record<string, string> = {};
  for (const k of COMPARED_HEADERS) { const v = res.headers.get(k); if (v !== null) h[k] = v; }
  if (h.allow) h.allow = h.allow.split(/,\s*/).sort().join(',');
  let json: any;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
  return { status: res.status, headers: h, cookies: res.headers.getSetCookie(), text, json };
}

// What legitimately differs between two calls (values computed at request time, random tokens), and the
// documented intentional differences (contract/COMPATIBILITY.md). Everything else must be byte-identical.
function volatile(path: string, s: string): string {
  let t = s;
  t = t.replace(/(Expires=)[^;]+/g, '$1<date>');
  t = t.replace(/("(?:uptime)":)[0-9.]+/g, '$1<n>').replace(/"(total|free|used|max)":\d+/g, '"$1":<n>');
  if (/^\/(\?|$)|^\/health/.test(path)) t = t.replace(/("timestamp":")[^"]+/g, '$1<now>');
  t = t.replace(/("timestamp":"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(\.\d+)?(Z|[+-]\d\d:\d\d)"/g, (_m, a, f, z) => `"timestamp":"<now:${f ? f.length - 1 : 0}${z}>"`);
  // Signed OAuth state / nonce cookies (random per request).
  t = t.replace(/(state=)[A-Za-z0-9_.%-]+/g, '$1<state>').replace(/(ceitba_oauth_state=)[^;]+/g, '$1<state>');
  // API keys stamp last_used_at on each call: the second server sees the first one's stamp.
  t = t.replace(/("lastUsedAt":")[^"]+/g, '$1<ts>');
  return t;
}

const sortKeys = (x: unknown): unknown => Array.isArray(x) ? x : x && typeof x === 'object'
  ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sortKeys((x as Record<string, unknown>)[k])])) : x;

function canon(path: string, r: Res) {
  let body = volatile(path, r.text);
  // Java built these bodies with Map.of: its key order is randomized per JVM start (ImmutableCollections.SALT).
  if (/^\/(\?|$)|^\/health$|^\/v1\/organizations\/[^/]+\/followers$/.test(path)) {
    try { body = volatile(path, JSON.stringify(sortKeys(JSON.parse(r.text)))); } catch { /* not json */ }
  }
  if (path.startsWith('/docs.json')) {
    try { const d = JSON.parse(r.text); delete d.servers; body = JSON.stringify(d); } catch { /* not json */ }
  }
  const headers = Object.fromEntries(Object.entries(r.headers).map(([k, v]) => [k, volatile(path, v)]));
  const cookies = r.cookies.map((c) => volatile(path, c)).sort();
  return { status: r.status, headers, cookies, body };
}

interface Diff { label: string; req: string; fields: Record<string, { java: unknown; bun: unknown }> }

function compare(label: string, r: Req, a: Res, b: Res, extra?: (s: string) => string): Diff | null {
  const ca = canon(r.path, a);
  const cb = canon(r.path, b);
  if (extra) { ca.body = extra(ca.body); cb.body = extra(cb.body); ca.headers = JSON.parse(extra(JSON.stringify(ca.headers))); cb.headers = JSON.parse(extra(JSON.stringify(cb.headers))); ca.cookies = ca.cookies.map(extra); cb.cookies = cb.cookies.map(extra); }
  const fields: Diff['fields'] = {};
  for (const k of ['status', 'headers', 'cookies', 'body'] as const) {
    const x = JSON.stringify(ca[k]);
    const y = JSON.stringify(cb[k]);
    if (x !== y) fields[k] = { java: ca[k], bun: cb[k] };
  }
  return Object.keys(fields).length ? { label, req: `${r.method} ${r.path}`, fields } : null;
}

// ------------------------------------------------------------------ GET catalog

interface Identity { name: string; userId: string | null; auth: Auth }

async function identities(sql: Sql): Promise<Identity[]> {
  const [staff] = await sql`SELECT id, email, name FROM "user" WHERE email = 'ceitba@itba.edu.ar'`;
  const [user] = await sql`SELECT id, email, name FROM "user" WHERE id = ${B}`;
  const [admin] = await sql`SELECT id, email, name FROM "user" WHERE id = ${U(5)}`;
  return [
    { name: 'anon', userId: null, auth: null },
    { name: 'user', userId: B, auth: { cookie: mintJwt(user!.id, user!.email, user!.name) } },
    { name: 'staff', userId: staff!.id, auth: { bearer: mintJwt(staff!.id, staff!.email, staff!.name) } },
    { name: 'orgadmin', userId: U(5), auth: { bearer: mintJwt(admin!.id, admin!.email, admin!.name) } },
    { name: 'apikey-staff', userId: staff!.id, auth: { apiKey: KEYS.staffFull } },
    { name: 'apikey-read', userId: B, auth: { apiKey: KEYS.userRead } },
  ];
}

/** Paths whose GET writes (tracking pixels, click redirects, review assignment): exercised in the writes phase. */
const WRITING_GETS = new Set(['/v1/mail/o/{file}', '/v1/mail/c/{trackingId}/{linkId}', '/v1/staff/kb/evals/{id}/review/next']);

async function getCatalog(sql: Sql, ids: Identity[]): Promise<{ identity: Identity; req: Req; op: string }[]> {
  const one = async (q: Promise<any[]>) => { const r = await q; const v = r[0] ? Object.values(r[0])[0] : null; if (v == null) throw new Error('resolver found nothing'); return String(v); };
  const kbPage = await one(sql`SELECT id FROM wiki.kb_page WHERE subject_id = 'B0001' AND slug = 'tema-01'`);
  const pubFile = await one(sql`SELECT id FROM wiki.drive_file WHERE drive_id = 'bench-df-1'`);
  void kbPage;
  const fixed: Record<string, Record<string, string>> = {
    '/v1/wiki/bookmarks/{subjectId}': { subjectId: 'B0001' },
    '/v1/plans/{planId}/subject/{subjectId}': { planId: 'BP-S-1', subjectId: (await one(sql`SELECT subject_id FROM plan_subject WHERE plan_id = 'BP-S-1' ORDER BY subject_id LIMIT 1`)) },
    '/v1/careers/{id}': { id: 'S' },
    '/v1/users/{userId}/organizations': { userId: U(5) },
    '/v1/proposals/{id}/comments': { id: P(1) },
    '/v1/proposals/{id}': { id: P(1) },
    '/v1/organizations/{slug}/announcements': { slug: ORG },
    '/v1/articles/{articleId}/votes': { articleId: 'bench-art-0001' },
    '/v1/study-groups/{id}': { id: G(1) },
    '/v1/organizations/{slug}': { slug: ORG },
    '/v1/news/events/{id}': { id: 'bench-evt-0033' },
    '/v1/news/events/{id}/attendees': { id: 'bench-evt-0033' },
    '/v1/digests/{id}': { id: DG(1) },
    '/v1/digests/{id}/stats': { id: DG(1) },
    '/v1/digests/{id}/preview': { id: DG(2) },
    '/v1/articles/{id}': { id: 'bench-art-0001' },
    '/v1/articles/{id}/preview': { id: 'bench-art-0001' },
    '/v1/wiki/subjects/{subjectId}/kb': { subjectId: 'B0001' },
    '/v1/wiki/subjects/{subjectId}/kb/{slug}': { subjectId: 'B0001', slug: 'tema-01' },
    '/v1/wiki/subjects/{subjectId}/kb/graph': { subjectId: 'B0001' },
    '/v1/wiki/subjects/{subjectId}/files': { subjectId: 'B0001' },
    '/v1/wiki/files/{fileId}': { fileId: pubFile },
    '/v1/wiki/files/{fileId}/download': { fileId: pubFile },
    '/v1/wiki/files/{fileId}/assets/{name}': { fileId: pubFile, name: 'img-1.png' },
    '/v1/users/{id}': { id: B },
    '/v1/subjects/{id}': { id: 'B0001' },
    '/v1/staff/kb/pipeline/runs/{id}': { id: KB(10) },
    '/v1/staff/kb/pipeline/runs/{id}/progress': { id: KB(10) },
    '/v1/staff/kb/models/{id}/stage-cost': { id: 'glm-5.3' },
    '/v1/staff/kb/evals/{id}': { id: KB(31) },
    '/v1/staff/kb/evals/{id}/review/progress': { id: KB(31) },
    '/v1/staff/kb/evals/{id}/progress': { id: KB(31) },
    '/v1/staff/kb/evals/{id}/pages': { id: KB(31) },
    '/v1/staff/kb/endpoints/{id}/stats': { id: KB(1) },
    '/v1/staff/capabilities/{key}/grants': { key: 'apuntes' },
    '/v1/share/sessions/{token}': { token: SHARE_TOKEN },
    '/v1/plans/{planId}/subjects': { planId: 'BP-S-1' },
    '/v1/plans/subjects/{subjectId}/plans': { subjectId: (await one(sql`SELECT subject_id FROM plan_subject WHERE plan_id = 'BP-S-1' ORDER BY subject_id LIMIT 1`)) },
    '/v1/organizations/{slug}/members': { slug: ORG },
    '/v1/organizations/{slug}/mail': { slug: ORG },
    '/v1/organizations/{slug}/followers': { slug: ORG },
    '/v1/organizations/{slug}/analytics': { slug: ORG },
    '/v1/classrooms/day/{day}': { day: 'MONDAY' },
    '/v1/classrooms/building/{building}': { building: 'SDF' },
  };
  // Per-identity "my" resources.
  const mine: Record<string, (uid: string) => Promise<Record<string, string>>> = {
    '/v1/me/schedules/{id}': async (uid) => ({ id: await one(sql`SELECT id FROM saved_schedules WHERE user_id IN (${uid}, ${B}) ORDER BY (user_id = ${uid}) DESC, is_primary DESC, id LIMIT 1`) }),
    '/v1/me/follows/{slug}/mail': async (uid) => ({ slug: await one(sql`SELECT org_slug FROM user_follows WHERE user_id IN (${uid}, ${B}) ORDER BY (user_id = ${uid}) DESC, org_slug LIMIT 1`) }),
    '/v1/me/drive/sources/{id}/tree': async () => ({ id: DS(1) }),
  };
  // Required/meaningful query strings, plus a few filter variants of the list endpoints.
  const query: Record<string, string[]> = {
    '/v1/staff-members': ['?year=2026', '?year=2025'],
    '/v1/wiki/kb/search': ['?q=derivadas%20parciales', '?q=matrices&subjectId=B0001&limit=3'],
    '/v1/subjects': ['?plan=BP-S-1'],
    '/v1/staff/kb/models/{id}/stage-cost': ['?stage=write', '?stage=DIGEST'],
    '/v1/staff/kb/evals/{id}/pages': ['?configKey=a&subjectId=B0001&slug=tema-01'],
    '/v1/commissions': ['?plan=BP-S-1', '?plan=NOPE'],
    '/v1/classrooms/availability': ['?day=MONDAY&at=10:00', '?day=TUESDAY&building=SDF&minMinutes=60', ''],
    '/v1/articles': ['', '?page=2&limit=5', '?category=Cultura&limit=3', '?organization=bench-org-6&status=draft', '?mine=true'],
    '/v1/news/events': ['', '?page=2&limit=10', '?category=Deportes', '?from=2026-01-01&to=2026-03-31&organization=bench-org-6'],
    '/v1/users': ['', '?q=bench1&limit=5', '?staff=true', '?organization=bench-org-6&sort=name', '?page=3&limit=20'],
    '/v1/study-groups': ['', '?subject=B0001', '?type=EXAMEN&upcoming=false', '?page=0&limit=1'],
    '/v1/proposals': ['', '?topic=CURSOS', '?page=0&limit=1'],
    '/v1/proposals/{id}/comments': ['', '?page=0&limit=1'],
    '/v1/staff/proposals': ['', '?status=PENDING', '?status=REJECTED'],
    '/v1/staff/schedule-corrections': ['', '?status=PENDING'],
    '/v1/staff/drive/files': ['', '?publication=PUBLISHED&limit=5', '?publication=HIDDEN_REPORTED'],
    '/v1/staff/drive/sources': ['', '?status=PENDING_REVIEW'],
    '/v1/staff/kb/pages': ['', '?status=PUBLISHED&limit=3'],
    '/v1/staff/kb/costs': ['', '?groupBy=model', '?from=2026-01-01&to=2026-12-31&groupBy=stage&reprice=true'],
    '/v1/staff/kb/pipeline/runs': ['', '?limit=1'],
    '/v1/plans/{planId}/subjects': ['', '?year=1&semester=2', '?section=Electivas'],
    '/v1/organizations/{slug}/analytics': ['', '?days=7'],
    '/v1/analytics/summary': ['', '?days=7'],
    '/v1/me/study-groups': ['', '?upcoming=true'],
    '/v1/wiki/apuntes/subjects': ['', '?q=materia&limit=5', '?mine=true'],
    '/v1/digests/{id}/preview': ['', '?mode=html', '?mode=text'],
    '/v1/digests/correction-vote': ['', '?token=garbage'],
    '/v1/auth/google': ['', '?redirect_uri=https://ceitba.org.ar/', '?redirect_uri=https://evil.example/'],
    '/v1/auth/callback': ['', '?error=access_denied', '?code=x&state=y'],
    '/v1/mail/accounts/oauth/callback': ['', '?error=access_denied'],
    '/v1/classrooms': ['', '?status=free', '?current_semester=true'],
  };
  const spec = JSON.parse(readFileSync(join(API_DIR, 'src/http/openapi.json'), 'utf8')) as { paths: Record<string, Record<string, unknown>> };
  const out: { identity: Identity; req: Req; op: string }[] = [];
  for (const p of Object.keys(spec.paths)) {
    if (!spec.paths[p]!.get || WRITING_GETS.has(p)) continue;
    for (const ident of ids) {
      let params: Record<string, string> = fixed[p] ?? {};
      if (mine[p]) params = await mine[p]!(ident.userId ?? B);
      const path = p.replace(/\{(\w+)\}/g, (_m, k: string) => { if (!(k in params)) throw new Error(`no value for ${k} in ${p}`); return encodeURIComponent(params[k]!); });
      for (const qs of query[p] ?? ['']) out.push({ identity: ident, op: `GET ${p}`, req: { method: 'GET', path: path + qs, auth: ident.auth } });
    }
  }
  // Not in the document but served: docs, actuator.
  for (const ident of ids.slice(0, 2)) {
    for (const p of ['/docs.json', '/actuator/health', '/actuator/health/liveness', '/actuator/health/readiness', '/actuator/info', '/v1/nope']) {
      out.push({ identity: ident, op: `GET ${p}`, req: { method: 'GET', path: p, auth: ident.auth } });
    }
  }
  return out;
}

/** Row count + md5 of every table, to prove a phase left the database untouched. */
async function fingerprint(sql: Sql): Promise<Map<string, string>> {
  const tables = await sql`SELECT schemaname, relname FROM pg_stat_user_tables ORDER BY 1, 2`;
  const m = new Map<string, string>();
  for (const t of tables) {
    const q = `"${t.schemaname}"."${t.relname}"`;
    const [r] = await sql.unsafe(`SELECT count(*)::int AS n, md5(coalesce(string_agg(md5(x::text), '' ORDER BY md5(x::text)), '')) AS h FROM ${q} x`);
    m.set(`${t.schemaname}.${t.relname}`, `${r!.n}:${r!.h}`);
  }
  return m;
}

// ------------------------------------------------------------------ phases

/**
 * VACUUM ANALYZE every table, so the later phases read tables laid out like production's (autovacuumed) rather
 * than freshly written heaps: a vacuum lets new rows reuse freed slots, which is what exposes a list whose order
 * only holds by accident (an unordered SELECT reads heap order). A single statement, outside any transaction.
 */
async function vacuum(sql: Sql) {
  await sql.unsafe('VACUUM ANALYZE').simple();
  console.error('VACUUM ANALYZE done');
}

async function phaseSeed() {
  const sql = connect(DB, 1);
  try {
    const [h] = await sql`SELECT count(*)::int AS n FROM flyway_schema_history`;
    if (!h?.n) throw new Error('migrate the database with the jar first');
    const [seeded] = await sql`SELECT count(*)::int AS n FROM "user" WHERE id = ${B}`;
    if (!seeded!.n) {
      const load = Bun.spawnSync([process.execPath, join(API_DIR, '..', '..', 'scripts', 'bench', 'load.ts'), 'seed']);
      await sql.unsafe(load.stdout.toString()).simple();
      console.error('load.ts seed applied');
    }
    await sql.unsafe(seedSql()).simple();
    await vacuum(sql);
    const counts = await sql`SELECT schemaname || '.' || relname AS t, n_live_tup::int AS n FROM pg_stat_user_tables ORDER BY 1`;
    const empty = counts.filter((c) => c.n === 0).map((c) => c.t);
    console.log(`seeded: ${counts.length} tables, ${counts.reduce((s, c) => s + c.n, 0)} rows; empty: ${empty.join(', ') || 'none'}`);
  } finally {
    await sql.end();
  }
}

// --------------------------------------------- write flows (enrich + writes)

interface Actors { a: { id: string; email: string; name: string }; b: { id: string; email: string; name: string }; staff: { id: string; email: string; name: string }; orgadmin: { id: string; email: string; name: string }; tag: string; week: number }
type Step = { label: string; as: keyof Omit<Actors, 'tag' | 'week'> | 'anon'; method: string; path: (v: Record<string, string>) => string; body?: (v: Record<string, string>) => unknown; capture?: (j: any, v: Record<string, string>) => void; raw?: boolean };

function flows(x: Actors): Step[] {
  const monday = (weeks: number) => { const d = new Date(); const day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day + 7 * weeks); return d.toISOString().slice(0, 10); };
  const due = new Date(Date.now() + 14 * 86400_000).toISOString().replace(/\.\d+Z$/, 'Z');
  const sched = { version: 2, planId: 'BP-S-1', subjects: [{ code: 'B0001', commission: 'A', color: '#a0c4ff', locked: true }], blockedTimes: [], options: { avoidGaps: true } };
  return [
    { label: 'device', as: 'a', method: 'PUT', path: () => '/v1/me/devices', body: () => ({ token: `fcm-${x.tag}-a`, platform: 'android', appVersion: '2.4.0' }) },
    { label: 'prefs', as: 'a', method: 'PATCH', path: () => '/v1/me/preferences', body: () => ({ theme: 'dark', language: 'en' }) },
    { label: 'profile', as: 'a', method: 'PATCH', path: () => '/v1/me/profile', body: () => ({ linkedin: 'https://www.linkedin.com/in/someone', instagram: 'some.one', discord: 'some.one1' }) },
    { label: 'profile-invalid', as: 'a', method: 'PATCH', path: () => '/v1/me/profile', body: () => ({ linkedin: 'not a url', careerId: 'NOPE' }) },
    { label: 'follow', as: 'a', method: 'POST', path: () => '/v1/me/follows/bench-org-7' },
    { label: 'follow-mail', as: 'a', method: 'PUT', path: () => '/v1/me/follows/bench-org-7/mail', body: () => ({ enabled: false }) },
    { label: 'my-follows', as: 'a', method: 'GET', path: () => '/v1/me/follows' },
    { label: 'save-schedule', as: 'a', method: 'POST', path: () => '/v1/me/schedules', body: () => ({ name: `Plan ${x.tag}`, careerId: 'S', plan: 'BP-S-1', payload: sched }), capture: (j, v) => { v.sa = j.id; } },
    { label: 'primary', as: 'a', method: 'PUT', path: (v) => `/v1/me/schedules/${v.sa}/primary` },
    { label: 'update-schedule', as: 'a', method: 'PUT', path: (v) => `/v1/me/schedules/${v.sa}`, body: () => ({ name: `Plan ${x.tag} v2`, careerId: 'S', plan: 'BP-S-1', payload: { ...sched, options: { avoidGaps: false } } }) },
    { label: 'save-schedule-b', as: 'b', method: 'POST', path: () => '/v1/me/schedules', body: () => ({ name: 'Mío', careerId: 'S', plan: 'BP-S-2', payload: sched }), capture: (j, v) => { v.sb = j.id; } },
    { label: 'share-create', as: 'a', method: 'POST', path: () => '/v1/share/sessions', body: (v) => ({ savedScheduleId: v.sa, displayName: 'Yo', name: `Sesión ${x.tag}` }), capture: (j, v) => { v.tok = j.token; } },
    { label: 'share-join', as: 'b', method: 'POST', path: (v) => `/v1/share/sessions/${v.tok}/join`, body: (v) => ({ savedScheduleId: v.sb, displayName: 'Vos' }) },
    { label: 'share-read', as: 'anon', method: 'GET', path: (v) => `/v1/share/sessions/${v.tok}` },
    { label: 'share-leave', as: 'b', method: 'DELETE', path: (v) => `/v1/share/sessions/${v.tok}/leave` },
    { label: 'proposal', as: 'a', method: 'POST', path: () => '/v1/proposals', body: () => ({ title: `Más enchufes ${x.tag}`, description: 'En la biblioteca faltan enchufes.', topic: 'VIDA_UNIVERSITARIA' }), capture: (j, v) => { v.p = j.id; } },
    { label: 'proposal-approve', as: 'staff', method: 'POST', path: (v) => `/v1/staff/proposals/${v.p}/approve` },
    { label: 'proposal-comment', as: 'b', method: 'POST', path: (v) => `/v1/proposals/${v.p}/comments`, body: () => ({ body: 'Sí, por favor' }), capture: (j, v) => { v.pc = j.id; } },
    { label: 'proposal-reply', as: 'a', method: 'POST', path: (v) => `/v1/proposals/${v.p}/comments`, body: (v) => ({ body: 'Gracias', parentId: v.pc }) },
    { label: 'proposal-vote', as: 'b', method: 'PUT', path: (v) => `/v1/proposals/${v.p}/vote`, body: () => ({ value: 'UP' }) },
    { label: 'proposal-lifecycle', as: 'staff', method: 'PATCH', path: (v) => `/v1/staff/proposals/${v.p}`, body: () => ({ lifecycle: 'ACEPTADO' }) },
    { label: 'proposal-read', as: 'b', method: 'GET', path: (v) => `/v1/proposals/${v.p}` },
    { label: 'proposal-comments', as: 'a', method: 'GET', path: (v) => `/v1/proposals/${v.p}/comments` },
    { label: 'proposal-2', as: 'b', method: 'POST', path: () => '/v1/proposals', body: () => ({ title: `Rechazable ${x.tag}`, description: 'x', topic: 'OTROS' }), capture: (j, v) => { v.p2 = j.id; } },
    { label: 'proposal-reject', as: 'staff', method: 'POST', path: (v) => `/v1/staff/proposals/${v.p2}/reject`, body: () => ({ reason: 'Duplicada' }) },
    { label: 'group', as: 'a', method: 'POST', path: () => '/v1/study-groups', body: () => ({ title: `Parcial ${x.tag}`, subjectId: 'B0004', type: 'TP_GRUPO', locations: ['VIRTUAL', 'SDF'], dueAt: due, maxParticipants: 3, description: 'Juntémonos' }), capture: (j, v) => { v.g = j.id; } },
    { label: 'group-join', as: 'b', method: 'POST', path: (v) => `/v1/study-groups/${v.g}/join` },
    { label: 'group-patch', as: 'a', method: 'PATCH', path: (v) => `/v1/study-groups/${v.g}`, body: () => ({ description: 'Cambio de planes', maxParticipants: 5 }) },
    { label: 'group-read', as: 'b', method: 'GET', path: (v) => `/v1/study-groups/${v.g}` },
    { label: 'group-leave', as: 'b', method: 'DELETE', path: (v) => `/v1/study-groups/${v.g}/membership` },
    { label: 'correction', as: 'a', method: 'POST', path: () => `/v1/commissions/${x.week === 0 ? 'B0002-A' : 'B0005-A'}/schedule-corrections`, body: () => ({ schedule: [{ day: 'MONDAY', time_from: '08:00', time_to: '10:00' }, { day: 'THURSDAY', time_from: '14:00', time_to: '16:00' }] }), capture: (j, v) => { v.c = j.correction?.id; } },
    { label: 'correction-vote', as: 'b', method: 'PUT', path: (v) => `/v1/schedule-corrections/${v.c}/vote`, body: () => ({ type: 'CONFIRM' }) },
    { label: 'my-corrections', as: 'a', method: 'GET', path: () => '/v1/me/schedule-corrections' },
    { label: 'rsvp', as: 'a', method: 'POST', path: () => '/v1/news/events/bench-evt-0999/rsvp' },
    { label: 'rsvps', as: 'a', method: 'GET', path: () => '/v1/me/rsvps' },
    { label: 'article-vote', as: 'anon', method: 'POST', path: () => '/v1/articles/bench-art-0002/votes', body: () => ({ type: 'up' }) },
    { label: 'bookmark', as: 'a', method: 'POST', path: () => '/v1/wiki/bookmarks/B0003' },
    { label: 'kb-report', as: 'b', method: 'PUT', path: (v) => `/v1/wiki/kb/pages/${v.kbPage}/report`, body: () => ({ reason: 'CONTENT_ERROR', comment: `typo ${x.tag}` }) },
    { label: 'file-report', as: 'b', method: 'PUT', path: (v) => `/v1/wiki/files/${v.file}/report`, body: () => ({ reason: 'SPAM' }) },
    { label: 'api-key', as: 'a', method: 'POST', path: () => '/v1/auth/api-keys', body: () => ({ name: `cli ${x.tag}`, ttlDays: 30, scopes: ['read', 'write'] }), capture: (j, v) => { v.key = j.key; v.keyId = j.id; } },
    { label: 'api-keys', as: 'a', method: 'GET', path: () => '/v1/auth/api-keys' },
    { label: 'highlight', as: 'staff', method: 'POST', path: () => '/v1/highlights', body: () => ({ title: `Destacado ${x.tag}`, imageUrl: 'https://ceitba.org.ar/img/x.png', position: 5, active: true }), capture: (j, v) => { v.h = j.id; } },
    { label: 'highlight-put', as: 'staff', method: 'PUT', path: (v) => `/v1/highlights/${v.h}`, body: () => ({ title: `Destacado ${x.tag}!`, imageUrl: 'https://ceitba.org.ar/img/y.png', startsAt: '2026-01-01T00:00:00Z', endsAt: '2027-01-01T00:00:00-03:00', active: true }) },
    { label: 'benefit-card', as: 'staff', method: 'POST', path: () => '/v1/benefit-cards', body: () => ({ categorySlug: 'convenios', titleEs: `Café ${x.tag}`, titleEn: 'Coffee', bulletsEs: ['10%'], price: '$ 1.000' }) },
    { label: 'staff-member', as: 'staff', method: 'POST', path: () => '/v1/staff-members', body: () => ({ year: 2026, departmentSlug: 'it', name: `Nuevo ${x.tag}`, roleEs: 'Miembro', roleEn: 'Member' }) },
    { label: 'moderator', as: 'staff', method: 'POST', path: () => '/v1/staff/moderators', body: () => ({ email: x.b.email }) },
    { label: 'cap-org', as: 'staff', method: 'PUT', path: () => `/v1/staff/capabilities/apuntes/orgs/bench-org-${x.week === 0 ? 8 : 9}` },
    { label: 'cap-users', as: 'staff', method: 'POST', path: () => '/v1/staff/capabilities/apuntes/users', body: () => ({ emails: [x.a.email, 'Mixed.Case@ITBA.edu.ar'] }) },
    { label: 'digest', as: 'staff', method: 'POST', path: () => '/v1/digests', body: () => ({ weekStart: monday(2 + x.week) }), capture: (j, v) => { v.d = j.id; } },
    { label: 'digest-patch', as: 'staff', method: 'PATCH', path: (v) => `/v1/digests/${v.d}`, body: () => ({ subject: `Digest ${x.tag}`, intro: 'Hola', excludedArticleIds: ['bench-art-0001'] }) },
    { label: 'digest-preview', as: 'staff', method: 'GET', path: (v) => `/v1/digests/${v.d}/preview` },
    { label: 'digest-sub', as: 'a', method: 'PUT', path: () => '/v1/digests/subscription', body: () => ({ enabled: false }) },
    { label: 'invite', as: 'orgadmin', method: 'POST', path: () => `/v1/organizations/${ORG}/members/invites`, body: () => ({ emails: [`new.${x.tag}@itba.edu.ar`, 'INVITEE@itba.edu.ar'], role: 'member' }) },
    { label: 'org-patch', as: 'orgadmin', method: 'PATCH', path: () => `/v1/organizations/${ORG}`, body: () => ({ description: `Actualizado ${x.tag}`, recruitingOpen: true, recruitingUrl: 'https://forms.example/x' }) },
    { label: 'announcement', as: 'orgadmin', method: 'POST', path: () => `/v1/organizations/${ORG}/announcements`, body: () => ({ subject: `Aviso ${x.tag}`, body: 'Hola a todos' }), capture: (j, v) => { v.an = String(j.id); } },
    { label: 'announcement-patch', as: 'orgadmin', method: 'PATCH', path: (v) => `/v1/organizations/${ORG}/announcements/${v.an}`, body: () => ({ subject: `Aviso ${x.tag} (editado)`, body: 'Hola a todos!' }) },
    { label: 'article', as: 'staff', method: 'POST', path: () => '/v1/articles', body: () => ({ id: `dropin-${x.tag}`, title: 'Nota', excerpt: 'Resumen', body: ['## Uno', 'Texto'], category: 'Cultura', organization: ORG, authors: ['CEITBA'], publishedAt: '2026-10-01', readingTime: '3 min', status: 'published' }) },
    { label: 'article-patch', as: 'staff', method: 'PATCH', path: () => `/v1/articles/dropin-${x.tag}`, body: () => ({ featured: true }) },
    { label: 'event', as: 'orgadmin', method: 'POST', path: () => '/v1/news/events', body: () => ({ id: `dropin-evt-${x.tag}`, title: 'Charla', eventDate: '2026-12-01', startTime: '18:00', endTime: '19:30', location: 'Aula 101', category: 'Tecnología', organization: ORG, signupMode: 'rsvp', capacity: 30 }) },
    { label: 'analytics', as: 'anon', method: 'POST', path: () => '/v1/analytics/events', body: () => ({ events: [{ type: 'page_view', sessionId: `s-${x.tag}`, path: '/newsletter' }, { type: 'article_view', sessionId: `s-${x.tag}`, articleId: 'bench-art-0001' }] }) },
    { label: 'conflicts', as: 'anon', method: 'POST', path: () => '/v1/classrooms/conflicts', body: () => ({ classroom: '100', building: 'PP', day: 'MONDAY', hourFrom: '15:00', hourTo: '17:00' }) },
    { label: 'pixel', as: 'anon', method: 'GET', path: () => `/v1/mail/o/${TRACK}.gif` },
    { label: 'click', as: 'anon', method: 'GET', path: () => `/v1/mail/c/${TRACK}/2` },
    { label: 'click-bad', as: 'anon', method: 'GET', path: () => '/v1/mail/c/nope/1' },
    { label: 'vote-view', as: 'anon', method: 'GET', path: (v) => `/v1/digests/correction-vote?token=${encodeURIComponent(voteToken(x.b.id, v.c!))}` },
    { label: 'vote-post', as: 'anon', method: 'POST', path: () => '/v1/digests/correction-vote', body: (v) => ({ token: voteToken(x.b.id, v.c!), vote: 'REJECT' }) },
    { label: 'eval-set', as: 'staff', method: 'POST', path: () => '/v1/staff/kb/evals/sets', body: () => ({ name: `Set ${x.tag}`, subjectIds: ['B0001', 'B0002'] }), capture: (j, v) => { v.es = j.id; } },
    { label: 'review-next', as: 'staff', method: 'GET', path: () => `/v1/staff/kb/evals/${KB(31)}/review/next` },
    { label: 'unbookmark', as: 'a', method: 'DELETE', path: () => '/v1/wiki/bookmarks/B0003' },
    { label: 'device-delete', as: 'a', method: 'DELETE', path: () => `/v1/me/devices/fcm-${x.tag}-a` },
    { label: 'key-delete', as: 'a', method: 'DELETE', path: (v) => `/v1/auth/api-keys/${v.keyId}` },
    { label: 'group-delete', as: 'a', method: 'DELETE', path: (v) => `/v1/study-groups/${v.g}` },
    { label: 'logout', as: 'a', method: 'POST', path: () => '/v1/auth/logout' },
  ];
}

async function runFlows(s: Srv, x: Actors, vars: Record<string, string>): Promise<{ step: Step; req: Req; res: Res }[]> {
  const tok = (who: Actors['a']) => mintJwt(who.id, who.email, who.name);
  const auth: Record<string, Auth> = { a: { cookie: tok(x.a) }, b: { bearer: tok(x.b) }, staff: { bearer: tok(x.staff) }, orgadmin: { bearer: tok(x.orgadmin) }, anon: null };
  const out: { step: Step; req: Req; res: Res }[] = [];
  for (const step of flows(x)) {
    let req: Req;
    try {
      req = { method: step.method, path: step.path(vars), auth: auth[step.as], body: step.body?.(vars) };
    } catch (e) {
      console.error(`${s.name} ${step.label}: skipped (${(e as Error).message})`);
      continue;
    }
    if (req.path.includes('undefined')) { console.error(`${s.name} ${step.label}: missing captured value, skipped`); continue; }
    const res = await send(s, req);
    if (res.status >= 400) console.error(`${s.name} ${step.label}: ${res.status} ${res.text.slice(0, 200)}`);
    if (step.capture && res.json) step.capture(res.json, vars);
    out.push({ step, req, res });
  }
  return out;
}

async function actors(sql: Sql, a: string, b: string, tag: string, week: number): Promise<Actors> {
  const row = async (q: Promise<any[]>) => { const [r] = await q; return { id: r!.id as string, email: r!.email as string, name: r!.name as string }; };
  return {
    a: await row(sql`SELECT id, email, name FROM "user" WHERE id = ${a}`),
    b: await row(sql`SELECT id, email, name FROM "user" WHERE id = ${b}`),
    staff: await row(sql`SELECT id, email, name FROM "user" WHERE email = 'ceitba@itba.edu.ar'`),
    orgadmin: await row(sql`SELECT id, email, name FROM "user" WHERE id = ${U(5)}`),
    tag, week,
  };
}

async function flowVars(sql: Sql, n: number): Promise<Record<string, string>> {
  const [p] = await sql`SELECT id FROM wiki.kb_page WHERE subject_id = 'B0002' AND slug = ${`tema-${String(n).padStart(2, '0')}`}`;
  const [f] = await sql`SELECT id FROM wiki.drive_file WHERE drive_id = ${`bench-df-${n}`}`;
  return { kbPage: p!.id, file: f!.id };
}

/** A digest correction vote link, minted like TuCuatrimestreSection does (Bun's code: Java must accept it too). */
function voteToken(userId: string, correctionId: string): string {
  const clock = { zone: 'America/Argentina/Buenos_Aires', now: () => Math.floor(Date.now() / 60_000) * 60_000_000, today: () => new Date().toISOString().slice(0, 10) };
  return new DigestCorrectionVoteTokens(new ContentHmac(SECRETS.AUTH_JWT_SECRET, SECRETS.CONTENT_HMAC_SECRET), clock as never, 14 * 86400_000).issue(userId, correctionId);
}

async function phaseEnrich() {
  const sql = connect(DB, 1);
  const java = await startServer('java', PORT_BASE + 1, DB);
  try {
    // Several rounds as different users, so the GET phase sees data the jar wrote.
    for (const [i, [a, b]] of [[U(20), U(21)], [U(22), U(23)], [B, U(24)]].entries()) {
      const x = await actors(sql, a!, b!, `enrich${i}`, 10 + i);
      const results = await runFlows(java, x, await flowVars(sql, 3 + i));
      const bad = results.filter((r) => r.res.status >= 500);
      console.log(`enrich round ${i}: ${results.length} requests, ${bad.length} 5xx`);
    }
    await vacuum(sql);
  } finally {
    await java.stop();
    await sql.end();
  }
}

async function phaseGet() {
  const sql = connect(DB, 2);
  const before = await fingerprint(sql);
  const java = await startServer('java', PORT_BASE + 1, DB);
  const bun = await startServer('bun', PORT_BASE + 2, DB);
  const diffs: Diff[] = [];
  const hist: Record<string, Record<string, number>> = {};
  let nonTrivial = 0;
  let total = 0;
  try {
    const ids = await identities(sql);
    const afterBoot = await fingerprint(sql);
    const bootChanged = [...afterBoot].filter(([k, v]) => before.get(k) !== v).map(([k]) => k);
    console.log(`boot changed tables: ${bootChanged.join(', ') || 'none'}`);
    const catalog = await getCatalog(sql, ids);
    for (const { identity, req, op } of catalog) {
      const a = await send(java, req);
      const b = await send(bun, req);
      total++;
      (hist[identity.name] ??= {})[a.status] = ((hist[identity.name] ??= {})[a.status] ?? 0) + 1;
      if (a.status === 200 && a.text.length > 30 && !/^\[\]$|"data":\[\]/.test(a.text)) nonTrivial++;
      const d = compare(`${identity.name} ${op}`, req, a, b);
      if (d) diffs.push(d);
    }
    const after = await fingerprint(sql);
    const changed = [...after].filter(([k, v]) => afterBoot.get(k) !== v).map(([k]) => k);
    console.log(`GET phase: ${total} request pairs, ${nonTrivial} non-trivial 200s, ${diffs.length} differ; tables changed by GETs: ${changed.join(', ') || 'none'}`);
    console.log(`status histogram (java) per identity: ${JSON.stringify(hist)}`);
    writeFileSync(join(OUT, 'get-diffs.json'), JSON.stringify(diffs, null, 2));
  } finally {
    await Promise.all([java.stop(), bun.stop()]);
    await sql.end();
  }
}

// Row-level diff after the writes: uuids mapped through the responses (same role -> same placeholder),
// timestamps reduced to null/not-null, random secrets reduced to their shape.
const RANDOM_COLS = new Set(['key_hash', 'token_hash', 'token', 'alias', 'tracking_id', 'refresh_token_enc', 'api_key_encrypted']);

async function tableRows(sql: Sql): Promise<Map<string, string[]>> {
  const cols = await sql`SELECT c.table_schema s, c.table_name t, c.column_name col, c.data_type dt, c.udt_name udt
                           FROM information_schema.columns c JOIN pg_stat_user_tables p ON p.schemaname = c.table_schema AND p.relname = c.table_name
                          ORDER BY 1, 2, c.ordinal_position`;
  const byTable = new Map<string, { col: string; dt: string; udt: string }[]>();
  for (const c of cols) { const k = `"${c.s}"."${c.t}"`; (byTable.get(k) ?? byTable.set(k, []).get(k)!).push({ col: c.col, dt: c.dt, udt: c.udt }); }
  const out = new Map<string, string[]>();
  for (const [t, cs] of byTable) {
    if (/scheduled_job_run|flyway_schema_history/.test(t)) continue;
    const sel = cs.map(({ col, dt, udt }) => {
      const q = `"${col}"`;
      if (/timestamp|date/.test(dt) && dt !== 'date') return `CASE WHEN ${q} IS NULL THEN 'null' ELSE 'ts' END AS ${q}`;
      if (udt === 'vector') return `md5(${q}::text) AS ${q}`;
      if (RANDOM_COLS.has(col)) return `CASE WHEN ${q} IS NULL THEN 'null' ELSE 'rnd' END AS ${q}`;
      return q;
    }).join(', ');
    const rows = await sql.unsafe(`SELECT row_to_json(x)::text AS j FROM (SELECT ${sel} FROM ${t}) x`);
    out.set(t, rows.map((r) => r.j as string));
  }
  return out;
}

function uuidMapper() {
  const m = new Map<string, string>();
  return (s: string) => s.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (u) => { if (!m.has(u)) m.set(u, `<id${m.size}>`); return m.get(u)!; });
}

async function phaseWrites() {
  const admin = connect('postgres', 1);
  const dbA = `${DB}_dropin_a`;
  const dbB = `${DB}_dropin_b`;
  for (const d of [dbA, dbB]) { await admin.unsafe(`DROP DATABASE IF EXISTS ${d} WITH (FORCE)`); await admin.unsafe(`CREATE DATABASE ${d} TEMPLATE ${DB}`); }
  const sqlA = connect(dbA, 2);
  const sqlB = connect(dbB, 2);
  const java = await startServer('java', PORT_BASE + 3, dbA);
  const bun = await startServer('bun', PORT_BASE + 4, dbB);
  try {
    const xa = await actors(sqlA, U(30), U(31), 'w', 0);
    const ra = await runFlows(java, xa, await flowVars(sqlA, 7));
    const rb = await runFlows(bun, xa, await flowVars(sqlB, 7));
    const mapA = uuidMapper();
    const mapB = uuidMapper();
    const diffs: Diff[] = [];
    const n = Math.min(ra.length, rb.length);
    if (ra.length !== rb.length) console.log(`WARNING: java ran ${ra.length} steps, bun ${rb.length}`);
    // Generated secrets/tokens and the request-time instants they come with.
    const rnd = (s: string) => s.replace(/ceitba_[A-Za-z0-9_-]{43}/g, '<apikey>').replace(/"token":"[A-Za-z0-9_-]{16,}"/g, '"token":"<token>"')
      .replace(/\/share\/sessions\/[A-Za-z0-9_-]{16,}/g, '/share/sessions/<token>')
      .replace(/"(authorAlias|alias)":"[^"]+"/g, '"$1":"<alias>"')
      // Request-time instants: the digits differ, the shape must not (offset; <= 6 fraction digits, trailing zeros stripped).
      .replace(/(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(\.\d+)?(Z|[+-]\d\d:\d\d)/g, (_m, _a, f, z) => `<ts${f && f.length - 1 > 6 ? `:${f.length - 1}` : ''}${z}>`);
    for (let i = 0; i < n; i++) {
      const { step, req, res } = ra[i]!;
      const other = rb[i]!;
      if (other.step.label !== step.label) { console.log(`step mismatch at ${i}: ${step.label} vs ${other.step.label}`); break; }
      const norm = (c: ReturnType<typeof canon>) => ({ status: c.status, headers: JSON.parse(rnd(JSON.stringify(c.headers))), cookies: c.cookies.map(rnd), body: rnd(c.body) });
      const A = mapA(JSON.stringify(norm(canon(req.path, res))));
      const Bs = mapB(JSON.stringify(norm(canon(other.req.path, other.res))));
      if (A !== Bs) {
        const ja = JSON.parse(A);
        const jb = JSON.parse(Bs);
        const fields: Diff['fields'] = {};
        for (const k of ['status', 'headers', 'cookies', 'body']) if (JSON.stringify(ja[k]) !== JSON.stringify(jb[k])) fields[k] = { java: ja[k], bun: jb[k] };
        diffs.push({ label: step.label, req: `${req.method} ${req.path}`, fields });
      }
    }
    const statuses = ra.map((r) => r.res.status);
    console.log(`writes: ${n} request pairs (${statuses.filter((s) => s < 300).length} 2xx, ${statuses.filter((s) => s >= 400 && s < 500).length} 4xx, ${statuses.filter((s) => s >= 500).length} 5xx on java), ${diffs.length} differ`);
    writeFileSync(join(OUT, 'write-diffs.json'), JSON.stringify(diffs, null, 2));
    // Let after-commit background work settle, then diff every table.
    await Bun.sleep(2000);
    const [ta, tb] = [await tableRows(sqlA), await tableRows(sqlB)];
    const rowDiffs: { table: string; onlyJava: string[]; onlyBun: string[] }[] = [];
    let rowsCompared = 0;
    for (const [t, rowsA] of ta) {
      const rowsB = tb.get(t) ?? [];
      rowsCompared += rowsA.length;
      const na = rowsA.map(mapA).sort();
      const nb = rowsB.map(mapB).sort();
      if (JSON.stringify(na) === JSON.stringify(nb)) continue;
      const count = (xs: string[]) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>());
      const ca = count(na);
      const cb = count(nb);
      const onlyJava = [...ca].flatMap(([k, v]) => Array(Math.max(0, v - (cb.get(k) ?? 0))).fill(k));
      const onlyBun = [...cb].flatMap(([k, v]) => Array(Math.max(0, v - (ca.get(k) ?? 0))).fill(k));
      rowDiffs.push({ table: t, onlyJava, onlyBun });
    }
    console.log(`row diff: ${ta.size} tables, ${rowsCompared} rows; ${rowDiffs.length} tables differ: ${rowDiffs.map((d) => `${d.table} (-${d.onlyJava.length}/+${d.onlyBun.length})`).join(', ') || 'none'}`);
    writeFileSync(join(OUT, 'row-diffs.json'), JSON.stringify(rowDiffs, null, 2));
  } finally {
    await Promise.all([java.stop(), bun.stop()]);
    await sqlA.end(); await sqlB.end();
    if (!argv.includes('--keep-clones')) for (const d of [dbA, dbB]) await admin.unsafe(`DROP DATABASE IF EXISTS ${d} WITH (FORCE)`);
    await admin.end();
  }
}

async function phaseSessions() {
  const sql = connect(DB, 1);
  const java = await startServer('java', PORT_BASE + 1, DB);
  const bun = await startServer('bun', PORT_BASE + 2, DB);
  const results: string[] = [];
  const check = (label: string, ok: boolean, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`); };
  try {
    const login = async (s: Srv) => (await send(s, { method: 'POST', path: '/v1/auth/review-login', body: { email: REVIEW_EMAIL, password: REVIEW_PASSWORD } }));
    const me = (s: Srv, auth: Auth) => send(s, { method: 'GET', path: '/v1/auth/me', auth });
    const refresh = (s: Srv, t: string) => send(s, { method: 'POST', path: '/v1/auth/refresh', body: { refreshToken: t } });
    for (const [from, to] of [[java, bun], [bun, java]] as const) {
      const l = await login(from);
      check(`${from.name} review-login`, l.status === 200, String(l.status));
      const at = l.json?.accessToken as string;
      const rt = l.json?.refreshToken as string;
      for (const auth of [{ bearer: at }, { cookie: at }] as Auth[]) {
        const r = await me(to, auth);
        check(`${from.name} access token as ${'bearer' in auth! ? 'bearer' : 'cookie'} on ${to.name}`, r.status === 200 && r.json?.email === REVIEW_EMAIL, String(r.status));
      }
      const r1 = await refresh(to, rt);
      check(`${from.name} refresh token on ${to.name}`, r1.status === 200, String(r1.status));
      const r2 = await refresh(from, r1.json?.refreshToken);
      check(`rotated (${to.name}) refresh token back on ${from.name}`, r2.status === 200, String(r2.status));
      // The session cookie of the web app (a JWT minted like the jar's JwtIssuerService) on both.
      // API keys: the review account may not create them, so a regular user does.
      const keyOwner: Auth = { bearer: mintJwt(U(40), 'bench40@itba.edu.ar', 'Usuario 40') };
      const created = await send(from, { method: 'POST', path: '/v1/auth/api-keys', auth: keyOwner, body: { name: `from ${from.name}`, ttlDays: 7, scopes: ['read'] } });
      check(`${from.name} creates an API key`, created.status === 201 || created.status === 200, String(created.status));
      const k = created.json?.key as string;
      const viaKey = await me(to, { apiKey: k });
      check(`${from.name} API key on ${to.name}`, viaKey.status === 200 && viaKey.json?.email === 'bench40@itba.edu.ar', String(viaKey.status));
      const listed = await send(to, { method: 'GET', path: '/v1/auth/api-keys', auth: keyOwner });
      check(`${from.name} API key listed by ${to.name}`, listed.status === 200 && JSON.stringify(listed.json).includes(created.json?.id), String(listed.status));
      const write = await send(to, { method: 'PUT', path: '/v1/me/devices', auth: { apiKey: k }, body: { token: `fcm-scope-${from.name}`, platform: 'ios' } });
      check(`${from.name} read-only key refused a write on ${to.name}`, write.status === 403, `${write.status} ${write.text.slice(0, 80)}`);
      const lo = await send(to, { method: 'POST', path: '/v1/auth/logout', body: { refreshToken: r2.json?.refreshToken } });
      const after = await refresh(from, r2.json?.refreshToken);
      check(`logout on ${to.name} revokes the refresh token for ${from.name}`, after.status === 401, `${lo.status} then ${after.status}`);
    }
    // The client address behind the vote fingerprint and the analytics ip_hash: without a trusted
    // X-Forwarded-For it is the socket peer; with one, the right-most entry.
    for (const [label, headers] of [['direct IPv4 peer', {}], ['behind the proxy (X-Forwarded-For)', { 'X-Forwarded-For': '203.0.113.7' }]] as const) {
      const art = label.startsWith('direct') ? 'bench-art-0010' : 'bench-art-0011';
      const v1 = await send(java, { method: 'POST', path: `/v1/articles/${art}/votes`, body: { type: 'up' }, headers });
      const v2 = await send(bun, { method: 'POST', path: `/v1/articles/${art}/votes`, body: { type: 'up' }, headers });
      check(`a vote cast on java then again on bun from one client (${label}) is deduplicated`, v1.text === v2.text, `java ${v1.text} then bun ${v2.text}`);
    }
    // A seeded API key and seeded refresh token rows (shape written by the jar's code paths).
    const seeded = await me(bun, { apiKey: KEYS.userFull });
    check('seeded full-scope API key on bun', seeded.status === 200, String(seeded.status));
    const expired = await me(bun, { apiKey: KEYS.expired });
    const expiredJ = await me(java, { apiKey: KEYS.expired });
    check('expired API key refused the same way', expired.status === expiredJ.status && expired.text === expiredJ.text, `${expiredJ.status}/${expired.status}`);
    const rt2 = await refresh(bun, RT('rt-2'));
    check('seeded refresh token on bun', rt2.status === 200, String(rt2.status));
    const reuse = await refresh(java, RT('rt-1'));
    check('rotated seeded refresh token refused on java (reuse)', reuse.status === 401, String(reuse.status));
    console.log(results.join('\n'));
    writeFileSync(join(OUT, 'sessions.txt'), results.join('\n'));
  } finally {
    await Promise.all([java.stop(), bun.stop()]);
    await sql.end();
  }
}

const PHASES: Record<string, () => Promise<void>> = { seed: phaseSeed, enrich: phaseEnrich, get: phaseGet, writes: phaseWrites, sessions: phaseSessions };
if (!PG || !DB || (!JAR && phases.some((p) => p !== 'seed')) || phases.length === 0 || phases.some((p) => !PHASES[p])) {
  console.error('usage: bun scripts/dropin.ts <seed|enrich|get|writes|sessions>... --pg postgres://u:p@h:port --db <name> --jar <jar> [--java-home H] [--out DIR] [--port-base N] [--keep-clones]');
  process.exit(2);
}
for (const p of phases) {
  console.error(`== ${p}`);
  await PHASES[p]!();
}
