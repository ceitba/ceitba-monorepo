// Port of apps/api/src/main/java/org/ceitba/api/service/kb/KbPageParser.java.
//
// Parses one page file (YAML frontmatter + Markdown body) and checks
// everything that does not need the database: frontmatter, slug/type, and
// that every `##` section cites a file. See kbValidator for the rest.
//
// YAML: Java uses SnakeYAML (YAML 1.1); this uses Bun.YAML (YAML 1.2). The
// fields the parser reads behave the same for the frontmatter the pipeline
// writes, with these known differences:
//   - `generated_at: 2026-10-02` is a Date in SnakeYAML and a string here; both
//     end up as 2026-10-02T00:00Z. An unquoted full timestamp keeps its own
//     offset here (SnakeYAML converts it to UTC); the instant is the same.
//   - YAML 1.1 booleans (yes/no/on/off) are strings here: `subject: yes` reports
//     a subject mismatch instead of "must be a quoted string".
//   - an integral float (`title: 1.0`) prints "1" here, "1.0" in Java.
//   - the "invalid frontmatter YAML: ..." message carries Bun's parser text.

import { isJavaWhitespace, jIsBlank, jStrip, javaValueOf, upperRoot, DOT, S } from './javaString';
import { selfLinkErrors, latexErrors, metaSectionErrors } from './kbStyleChecks';
import { parse as parseLinks, SLUG, stripCode, type Parsed } from './kbWikilinks';
import { Odt, parseLocalDate } from './odt';
import { KB_PAGE_TYPES, type KbPageType } from './types';
import { parseUuid, type Uuid } from './uuid';
import { javaTrim, javaSplit } from '../../../lib/javaCompat';

export const MAX_CONTENT_CHARS = 400_000;

// Common English slugs the writers produce; pages use Spanish slugs.
export const ENGLISH_SLUGS = new Set(['fundamentals', 'vouchers', 'introduction', 'overview', 'summary', 'basics']);
export const MAX_CITATION_LABEL = 60;

// "graph" would collide with GET /v1/wiki/subjects/{id}/kb/graph.
export const RESERVED = new Set(['graph']);

const H2 = new RegExp(`^##(?!#)${S}+(${DOT}*)$`);

// Column sizes (kb_page.slug/generator, kb_link.raw/to_slug/to_subject_id):
// a longer value rejects the page instead of failing the whole import.
export const MAX_SLUG = 128;
export const MAX_GENERATOR = 128;
export const MAX_LINK_RAW = 256;
export const MAX_LINK_SUBJECT = 25;

// Markdown only (defence in depth; the SPA renders with skipHtml too):
// HTML tags or comments, javascript:/data:/vbscript: links and images
// loaded from another site are refused. Code is ignored.
// CASE_INSENSITIVE without UNICODE_CASE is ASCII-only folding: JS `i` without `u` matches that here.
const HTML_TAG = new RegExp(
  '<!--|</?(?:a|abbr|b|base|blockquote|body|br|button|canvas|center|code|details|dialog|div|em|embed|font|form' +
    '|frame|frameset|h[1-6]|head|hr|html|i|iframe|img|input|kbd|link|li|marquee|math|meta|noscript|object' +
    '|ol|option|p|picture|pre|s|script|select|small|source|span|strong|style|sub|summary|sup|svg|table' +
    `|tbody|td|template|textarea|th|thead|title|tr|u|ul|video|audio|xmp)(?=[ \\t\\n\\x0B\\f\\r/>])`,
  'i',
);
const UNSAFE_LINK = new RegExp(
  `(?:\\]\\(${S}*<?|^${S}*\\[[^\\]\\n]+\\]:${S}*<?|<)${S}*(?:javascript|data|vbscript)${S}*:`,
  'im',
);
const EXTERNAL_IMAGE = new RegExp(`!\\[[^\\]\\n]*\\]\\(${S}*<?${S}*(?:[a-z][a-z0-9+.-]*:|//)`, 'i');

export interface Draft {
  slug: string;
  type: KbPageType;
  title: string;
  subject: string;
  summary: string;
  aliases: string[];
  sources: Uuid[];
  generator: string;
  generatedAt: Odt;
  body: string;
  links: Parsed;
}

export class Result {
  constructor(readonly draft: Draft | null, readonly errors: string[]) {}

  ok(): boolean {
    return this.errors.length === 0;
  }
}

type Yaml = { parse(text: string): unknown };
const YAML: Yaml = (globalThis as unknown as { Bun: { YAML: Yaml } }).Bun.YAML;

/** path: "slug.md" (a leading directory is ignored); folderSubjectId: the subject being imported. */
export function parse(path: string | null, content: string | null, folderSubjectId: string): Result {
  const errors: string[] = [];
  const slug = slugOf(path);
  if (slug == null || !SLUG.test(slug)) {
    errors.push(`invalid slug '${slug}': lowercase letters, digits and hyphens, file name *.md`);
  }
  if (slug != null && RESERVED.has(slug)) errors.push(`slug '${slug}' is reserved`);
  if (slug != null && slug.length > MAX_SLUG) errors.push(`slug longer than ${MAX_SLUG} characters`);
  if (content == null || jIsBlank(content)) {
    errors.push('empty file');
    return new Result(null, errors);
  }
  if (content.length > MAX_CONTENT_CHARS) {
    errors.push(`file too large (max ${MAX_CONTENT_CHARS} characters)`);
    return new Result(null, errors);
  }
  let text = content.replaceAll('\r\n', '\n');
  if (text.startsWith('﻿')) text = text.substring(1);
  if (!text.startsWith('---\n')) {
    errors.push('missing frontmatter (the file must start with ---)');
    return new Result(null, errors);
  }
  let close = text.indexOf('\n---', 3);
  while (close >= 0 && !(close + 4 === text.length || text[close + 4] === '\n')) {
    close = text.indexOf('\n---', close + 4);
  }
  if (close < 0) {
    errors.push('frontmatter is not closed with ---');
    return new Result(null, errors);
  }
  const yaml = close >= 4 ? text.substring(4, close) : '';
  let body = close + 4 >= text.length ? '' : text.substring(close + 5);
  body = jStrip(body);

  let fm: Record<string, unknown>;
  try {
    const loaded = YAML.parse(yaml);
    if (typeof loaded !== 'object' || loaded === null || Array.isArray(loaded)) {
      errors.push('frontmatter is not a YAML mapping');
      return new Result(null, errors);
    }
    fm = loaded as Record<string, unknown>;
  } catch (e) {
    errors.push(`invalid frontmatter YAML: ${firstLine(e instanceof Error ? e.message : String(e))}`);
    return new Result(null, errors);
  }
  const get = (k: string): unknown => (Object.prototype.hasOwnProperty.call(fm, k) ? fm[k] : undefined) ?? null;

  const title = requiredString(get('title'), 'title', errors);
  const summary = requiredString(get('summary'), 'summary', errors);
  const generator = requiredString(get('generator'), 'generator', errors);
  if (generator != null && generator.length > MAX_GENERATOR) {
    errors.push(`frontmatter: generator longer than ${MAX_GENERATOR} characters`);
  }

  let subject: string | null = null;
  const rawSubject = get('subject');
  if (rawSubject == null) {
    errors.push('frontmatter: subject is required');
  } else if (typeof rawSubject !== 'string') {
    errors.push('frontmatter: subject must be a quoted string (e.g. subject: "61.12")');
  } else {
    subject = javaTrim(rawSubject);
    if (subject !== folderSubjectId) {
      errors.push(`frontmatter: subject '${subject}' does not match the folder '${folderSubjectId}'`);
    }
  }

  let type: KbPageType | null = null;
  const rawType = get('type');
  if (rawType == null) {
    errors.push('frontmatter: type is required (index | topic | concept)');
  } else {
    const t = upperRoot(javaTrim(javaValueOf(rawType)));
    if ((KB_PAGE_TYPES as readonly string[]).includes(t)) type = t as KbPageType;
    else errors.push('frontmatter: type must be index, topic or concept');
  }
  if (type != null && slug != null) {
    if (type === 'INDEX' && slug !== 'index') errors.push('type: index is only for index.md');
    if (type !== 'INDEX' && slug === 'index') errors.push('index.md must have type: index');
  }

  const aliases: string[] = [];
  const rawAliases = get('aliases');
  if (rawAliases != null) {
    if (Array.isArray(rawAliases)) {
      for (const a of rawAliases) {
        if (a == null || jIsBlank(javaValueOf(a))) continue;
        aliases.push(javaTrim(javaValueOf(a)));
      }
    } else {
      errors.push('frontmatter: aliases must be a list');
    }
  }

  const sources = new Set<Uuid>();
  const rawSources = get('sources');
  if (rawSources == null) {
    errors.push('frontmatter: sources is required (a list of file ids, may be empty)');
  } else if (Array.isArray(rawSources)) {
    for (const s of rawSources) {
      const id = parseUuid(javaTrim(javaValueOf(s)));
      if (id == null) errors.push(`frontmatter: source '${javaValueOf(s)}' is not a file id`);
      else sources.add(id);
    }
  } else {
    errors.push('frontmatter: sources must be a list');
  }

  let generatedAt: Odt | null = null;
  const rawDate = get('generated_at');
  if (rawDate == null) {
    errors.push('frontmatter: generated_at is required');
  } else if (rawDate instanceof Date) {
    generatedAt = Odt.ofEpochMilli(rawDate.getTime());
  } else {
    const s = javaTrim(javaValueOf(rawDate));
    if (s.length === 10) {
      const d = parseLocalDate(s);
      if (d) generatedAt = Odt.ofEpoch(Date.UTC(d.year, d.month - 1, d.day) / 1000, 0, 0);
    } else {
      generatedAt = Odt.tryParse(s);
    }
    if (generatedAt == null) errors.push('frontmatter: generated_at must be a date (YYYY-MM-DD)');
  }

  if (jIsBlank(body)) errors.push('empty page body');
  for (const section of sectionsWithoutCitation(body)) {
    errors.push(`section '${section}' has no [[file:…]] citation`);
  }
  errors.push(...citationFormatErrors(body));
  if (slug != null && ENGLISH_SLUGS.has(slug)) errors.push(`slug must be Spanish ('${slug}')`);
  const links = parseLinks(body, folderSubjectId, slug);
  for (const c of links.citations) {
    if (c.id == null) errors.push(`invalid citation [[${c.raw}]]`);
  }
  for (const l of links.links) {
    if (l.raw.length > MAX_LINK_RAW || l.slug.length > MAX_SLUG || l.subjectId.length > MAX_LINK_SUBJECT) {
      errors.push(`link too long: [[${preview(l.raw)}...]]`);
    }
  }
  errors.push(...unsafeMarkdownErrors(body));
  errors.push(...latexErrors(body));
  errors.push(...metaSectionErrors(body));
  errors.push(...selfLinkErrors(links, folderSubjectId, slug));

  if (errors.length > 0) return new Result(null, errors);
  return new Result(
    {
      slug: slug!,
      type: type!,
      title: title!,
      subject: subject!,
      summary: summary!,
      aliases,
      sources: [...sources],
      generator: generator!,
      generatedAt: generatedAt!,
      body,
      links,
    },
    errors,
  );
}

/**
 * Citations are short references at the end of a sentence, never wrapping
 * content (port of scripts/kb/validate_kb.py): closed on the same line,
 * label <= 60 characters, no math in the label.
 */
export function citationFormatErrors(body: string): string[] {
  const out: string[] = [];
  const text = stripCode(body);
  let from = 0;
  while (true) {
    const at = text.indexOf('[[file:', from);
    if (at < 0) break;
    const end = text.indexOf(']]', at);
    const seg = text.substring(at, end < 0 ? text.length : end);
    if (seg.length > 7 && isJavaWhitespace(seg.charCodeAt(7))) {
      out.push(
        "citation format: no space allowed after 'file:'; write [[file:<id>|short name]], with the " +
          `id of one of the page's sources right after the colon: ${preview(seg)}`,
      );
    } else if (end < 0 || seg.includes('\n')) {
      out.push(`citation not closed on the same line: ${preview(seg)}...`);
    } else {
      const bar = seg.indexOf('|');
      if (bar >= 0 && (seg.length - bar - 1 > MAX_CITATION_LABEL || seg.includes('$'))) {
        out.push(`citation label must be a short file name (<= ${MAX_CITATION_LABEL} chars, no math): ${preview(seg)}`);
      }
    }
    from = at + 7;
  }
  return out;
}

/** Raw HTML, script/data links and remote images (outside code and math, where "a<b y" is not a tag). */
export function unsafeMarkdownErrors(body: string): string[] {
  const out: string[] = [];
  const text = stripCode(body)
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\$[^$\n]+\$/g, ' ');
  const m = HTML_TAG.exec(text);
  if (m) out.push(`raw HTML is not allowed (${preview(text.substring(m.index))})`);
  if (UNSAFE_LINK.test(text)) out.push('javascript:, data: and vbscript: links are not allowed');
  if (EXTERNAL_IMAGE.test(text)) out.push('images from other sites are not allowed');
  return out;
}

function preview(s: string): string {
  const p = s.replaceAll('\n', ' ');
  return p.length <= 70 ? p : p.substring(0, 70);
}

/** Headings of `##` sections (up to the next `##`, ### included) without a [[file:...]] citation. */
export function sectionsWithoutCitationCount(body: string): number {
  return sectionsWithoutCitation(body).length;
}

export function sectionsWithoutCitation(body: string): string[] {
  const out: string[] = [];
  let heading: string | null = null;
  let cited = false;
  for (const line of javaSplit(stripCode(body), /\n/, -1)) {
    const m = H2.exec(line);
    if (m) {
      if (heading != null && !cited) out.push(heading);
      heading = javaTrim(m[1]!);
      cited = false;
    }
    if (line.includes('[[file:')) cited = true;
  }
  if (heading != null && !cited) out.push(heading);
  return out;
}

export function slugOf(path: string | null): string | null {
  if (path == null) return null;
  const name = path.substring(path.lastIndexOf('/') + 1);
  return name.endsWith('.md') ? name.substring(0, name.length - 3) : name;
}

function requiredString(v: unknown, key: string, errors: string[]): string | null {
  if (v == null || jIsBlank(javaValueOf(v))) {
    errors.push(`frontmatter: ${key} is required`);
    return null;
  }
  if (typeof v === 'object' && !(v instanceof Date)) {
    errors.push(`frontmatter: ${key} must be text`);
    return null;
  }
  return javaTrim(javaValueOf(v));
}

function firstLine(s: string | null): string {
  if (s == null) return '';
  const nl = s.indexOf('\n');
  return nl < 0 ? s : s.substring(0, nl);
}
