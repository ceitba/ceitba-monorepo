// Port of apps/api/src/main/java/org/ceitba/api/service/kb/pipeline/KbPageFiles.java.
//
// Page files (frontmatter + Markdown) as the pipeline handles them: the
// current page rebuilt from the database, and an LLM draft normalized so
// the system owns subject/type/sources/generator/generated_at.
// YAML is read with Bun.YAML (YAML 1.2; Java: SnakeYAML 1.1), see kbPageParser.ts.
// TODO(kb-service): of(KbPage) = file(title, subjectId, type.wire, summary, aliases, sources,
// generator, generatedAt's local date, markdown) once the KbPage row type exists.

import { toJavaJson } from '../../../../lib/json';
import { jIsBlank, jStrip, jTrim, javaValueOf } from '../javaString';
import type { KbPageType } from '../types';

export interface Parts {
  /** null when the file has none or it is not a mapping. */
  frontmatter: Record<string, unknown> | null;
  body: string;
}

type Yaml = { parse(text: string): unknown };
const YAML: Yaml = (globalThis as unknown as { Bun: { YAML: Yaml } }).Bun.YAML;

const CITATION = /\[\[file:([0-9a-fA-F-]{36})/g;

/** generatedAt: a LocalDate as YYYY-MM-DD. */
export function file(
  title: string | null,
  subjectId: string | null,
  type: string,
  summary: string | null,
  aliases: Iterable<string> | null,
  sources: Iterable<string> | null,
  generator: string | null,
  generatedAt: string,
  body: string,
): string {
  return (
    '---\n' +
    'title: ' + q(title) + '\n' +
    'subject: ' + q(subjectId) + '\n' +
    'type: ' + type + '\n' +
    'summary: ' + q(summary) + '\n' +
    'aliases: ' + list(aliases) + '\n' +
    'sources: ' + list(sources) + '\n' +
    'generator: ' + q(generator) + '\n' +
    'generated_at: ' + generatedAt + '\n' +
    '---\n\n' + jStrip(body) + '\n'
  );
}

/** Splits a file; frontmatter null when it has none or it is not a mapping. */
export function split(content: string | null): Parts {
  let text = jStrip(content == null ? '' : content.replaceAll('\r\n', '\n'));
  if (text.startsWith('```')) {
    // a fenced answer
    text = jStrip(text.replace(/^```[a-zA-Z]*\n/, '').replace(/\n```[ \t\n\x0B\f\r]*$/, ''));
  }
  if (!text.startsWith('---\n')) return { frontmatter: null, body: text };
  const close = text.indexOf('\n---', 3);
  if (close < 0) return { frontmatter: null, body: text };
  let fm: Record<string, unknown> | null = null;
  try {
    const loaded = YAML.parse(text.substring(4, close));
    if (typeof loaded === 'object' && loaded !== null && !Array.isArray(loaded)) fm = loaded as Record<string, unknown>;
  } catch {
    // invalid YAML: normalized from the operation below
  }
  const body = close + 4 >= text.length ? '' : text.substring(close + 4);
  return { frontmatter: fm, body: jStrip(body) };
}

/**
 * The draft with a frontmatter the system controls: subject/type/slug from the
 * operation, sources = the files cited in the body, our generator/date.
 * today: a LocalDate as YYYY-MM-DD.
 */
export function normalize(draft: string | null, subjectId: string, type: KbPageType, fallbackTitle: string, generator: string, today: string): string {
  const parts = split(draft);
  const fm = parts.frontmatter ?? {};
  const get = (k: string) => (Object.prototype.hasOwnProperty.call(fm, k) ? fm[k] : null);
  const title = str(get('title'), fallbackTitle);
  const summary = str(get('summary'), title + '.');
  const aliases: string[] = [];
  const rawAliases = get('aliases');
  if (Array.isArray(rawAliases)) {
    for (const a of rawAliases) if (a != null && !jIsBlank(javaValueOf(a))) aliases.push(jTrim(javaValueOf(a)));
  }
  return file(title, subjectId, type.toLowerCase(), summary, aliases, citedIds(parts.body), generator, today, parts.body);
}

/** The same file with another body (frontmatter kept as is). */
export function replaceBody(f: string, body: string): string {
  const close = f.indexOf('\n---', 3);
  if (!f.startsWith('---\n') || close < 0) return body;
  return f.substring(0, close + 4) + '\n\n' + jStrip(body) + '\n';
}

export function citedIds(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(CITATION)) out.add(m[1]!.toLowerCase());
  return [...out];
}

function str(o: unknown, fallback: string): string {
  if (o == null) return fallback;
  const s = jStrip(javaValueOf(o));
  return s.length === 0 ? fallback : s;
}

/** JSON strings and arrays are valid YAML (Jackson's writeValueAsString). */
function q(s: string | null): string {
  return toJavaJson(s == null ? '' : s);
}

function list(values: Iterable<string> | null): string {
  return toJavaJson(values == null ? [] : [...values]);
}
