// GoogleDocsHtml.normalize + DocHtmlSanitizer.sanitize on the jsoup port, step
// by step like the Java (spike 4: .spikes-archive/html/pipeline.ts), including
// the pretty-printed intermediates (normalize's doc.outerHtml() and sanitize's
// doc.body().html(), both with default OutputSettings) whose whitespace text
// nodes survive into the stored HTML, so the output (and the Doc content
// fingerprint hashed from it) is byte-identical to Java's.

import { javaIsBlank, javaSplit } from '../../../../lib/javaCompat';
import { descendants, detach, El, replaceWith, Txt } from './dom';
import { parseBodyFragment, parseDoc } from './builders';
import { innerCompact, innerPretty, javaTrim, text } from './print';

// ================= GoogleDocsHtml ==========================================

const S = '[ \\t\\n\\x0B\\f\\r]'; // Java \s
const RULE = /([^{}]+)\{([^{}]*)}/g;
const IMPORT = /@import[^;]*;/g;
const CLASS_SELECTOR = /^(?:[a-z0-9]+)?\.([A-Za-z0-9_-]+)$/;
const LIST_CLASS = /^lst-kix_(.+)-(\d+)$/;
const LIST_BEFORE = new RegExp(`^\\.(lst-kix_.+-\\d+)${S}*>${S}*li:before$`);
const LIST_SELECTOR = /^(?:ol|ul)?\.(lst-kix_.+-\d+)$/;
const COUNTER_STYLE = new RegExp(`counter\\([^,)]+,${S}*([a-z-]+)${S}*\\)`);
const PT = /^(-?[0-9.]+)pt$/;
type Decls = Map<string, string>;

/** selector -> declarations (property lower-cased -> value), in order. */
export function parseCss(css: string): Map<string, Decls> {
  const out = new Map<string, Decls>();
  for (const m of css.replace(IMPORT, '').matchAll(RULE)) {
    const decls: Decls = new Map();
    for (const d of javaSplit(m[2]!, /;/)) {
      const colon = d.indexOf(':');
      if (colon <= 0) continue;
      decls.set(javaTrim(d.slice(0, colon)).toLowerCase(), javaTrim(d.slice(colon + 1)));
    }
    for (const sel of javaSplit(m[1]!, /,/)) {
      const k = javaTrim(sel);
      if (!out.has(k)) out.set(k, new Map());
      for (const [a, b] of decls) out.get(k)!.set(a, b);
    }
  }
  return out;
}

function classDeclarations(rules: Map<string, Decls>) {
  const out = new Map<string, Decls>();
  for (const [sel, decls] of rules) {
    const m = CLASS_SELECTOR.exec(sel);
    if (!m) continue;
    if (!out.has(m[1]!)) out.set(m[1]!, new Map());
    for (const [a, b] of decls) out.get(m[1]!)!.set(a, b);
  }
  return out;
}

function listTypes(rules: Map<string, Decls>) {
  const out = new Map<string, string>();
  for (const [sel, decls] of rules) {
    const before = LIST_BEFORE.exec(sel);
    if (before) {
      const c = COUNTER_STYLE.exec(decls.get('content') ?? '');
      if (c) out.set(before[1]!, c[1]!);
      continue;
    }
    const list = LIST_SELECTOR.exec(sel);
    const type = decls.get('list-style-type');
    if (list && type != null && type !== 'none' && !out.has(list[1]!)) out.set(list[1]!, type);
  }
  return out;
}

const classNames = (el: El) => [...new Set(javaTrim(el.attr('class')).split(/[ \t\n\f\r]+/).filter((c) => c))];

function declarationsOf(el: El, classes: Map<string, Decls>): Decls {
  const out: Decls = new Map();
  for (const c of classNames(el)) for (const [a, b] of classes.get(c) ?? []) out.set(a, b);
  if (el.has('style')) {
    for (const d of javaSplit(el.attr('style'), /;/)) {
      const colon = d.indexOf(':');
      if (colon > 0) out.set(javaTrim(d.slice(0, colon)).toLowerCase(), javaTrim(d.slice(colon + 1)));
    }
  }
  return out;
}

const isBlankStr = (s: string) => /^[ \t\n\f\r]*$/.test(s);
const hasText = (el: El): boolean => el.children.some((c) => (c.kind === 'txt' && !c.data && !isBlankStr(c.value)) || (c.kind === 'el' && hasText(c)));
const hasAncestor = (el: El, re: RegExp) => {
  for (let p = el.parent; p; p = p.parent) if (re.test(p.name)) return true;
  return false;
};
const selectTag = (el: El, tag: string) => [...descendants(el)].filter((e) => e.name === tag);

/** Double.parseDouble, 0 when it does not parse (the Java catches NumberFormatException). */
function numeric(s: string): number {
  const t = javaTrim(s);
  return /^[+-]?(NaN|Infinity|(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?)[fFdD]?$/.test(t) ? parseFloat(t.replace(/[fFdD]$/, '')) : 0;
}

function wrapContents(el: El, tag: string) {
  const w = new El(tag);
  for (const n of [...el.children]) w.append(n);
  el.append(w);
}

function format(el: El, d: Decls) {
  const tag = el.name;
  if (!['span', 'p', 'li', 'td', 'th'].includes(tag)) return;
  if (!hasText(el) && selectTag(el, 'img').length === 0) return;
  const inHeading = /^h[1-6]$/.test(tag) || hasAncestor(el, /^(h1|h2|h3|h4|h5|h6)$/);
  const inLink = hasAncestor(el, /^a$/) || selectTag(el, 'a').length > 0;
  const weight = d.get('font-weight') ?? '';
  const bold = !inHeading && (weight === 'bold' || weight === 'bolder' || numeric(weight) >= 600);
  const italic = (d.get('font-style') ?? '').includes('italic');
  const deco = `${d.get('text-decoration') ?? ''} ${d.get('text-decoration-line') ?? ''}`;
  const underline = !inLink && deco.includes('underline');
  const strike = deco.includes('line-through');
  const valign = d.get('vertical-align') ?? '';
  if (valign === 'super') wrapContents(el, 'sup');
  if (valign === 'sub') wrapContents(el, 'sub');
  if (strike) wrapContents(el, 's');
  if (underline) wrapContents(el, 'u');
  if (italic) wrapContents(el, 'em');
  if (bold) wrapContents(el, 'strong');
}

function align(el: El, d: Decls) {
  const a = d.get('text-align') ?? '';
  if (a !== 'center' && a !== 'right') return;
  if (/^(p|h[1-6]|li|td|th|div)$/.test(el.name)) el.set('data-align', a);
}

export function olType(t: string | null | undefined): string | null {
  switch (t) {
    case 'decimal': case 'decimal-leading-zero': return '1';
    case 'lower-latin': case 'lower-alpha': return 'a';
    case 'upper-latin': case 'upper-alpha': return 'A';
    case 'lower-roman': return 'i';
    case 'upper-roman': return 'I';
    default: return null;
  }
}

type ListInfo = { id: string; level: number; cls: string };
function listInfo(el: El): ListInfo | null {
  if (el.name !== 'ul' && el.name !== 'ol') return null;
  for (const c of classNames(el)) {
    const m = LIST_CLASS.exec(c);
    if (m) return { id: m[1]!, level: parseInt(m[2]!, 10), cls: c };
  }
  return null;
}

function nestLists(container: El, types: Map<string, string>) {
  const stack: { info: ListInfo; list: El }[] = [];
  const counts = new Map<string, number>();
  const lis = (e: El) => e.elements().filter((c) => c.name === 'li');
  for (const child of container.elements()) {
    if (child.parent !== container) continue;
    const info = listInfo(child);
    if (!info) {
      stack.length = 0;
      continue;
    }
    const ordered = child.name === 'ol';
    if (ordered) {
      const t = olType(types.get(info.cls));
      if (t) child.set('type', t);
    }
    if (classNames(child).some((c) => c.toLowerCase() === 'start')) counts.set(info.cls, 0);
    while (stack.length && stack[stack.length - 1]!.info.level > info.level) stack.pop();
    let top = stack[stack.length - 1];
    if (top && top.info.level === info.level) {
      if (top.info.id === info.id && top.list.name === child.name) {
        const items = lis(child);
        for (const i of items) top.list.append(i);
        counts.set(info.cls, (counts.get(info.cls) ?? 0) + items.length);
        detach(child);
        continue;
      }
      stack.pop();
      top = stack[stack.length - 1];
    }
    if (ordered && !child.has('start')) {
      const seen = counts.get(info.cls) ?? 0;
      if (seen > 0) child.set('start', String(seen + 1));
    }
    counts.set(info.cls, (counts.get(info.cls) ?? 0) + lis(child).length);
    if (top && top.info.level < info.level) {
      const items = lis(top.list);
      if (items.length) items[items.length - 1]!.append(child);
    }
    stack.push({ info, list: child });
  }
}

function indent(body: El, classes: Map<string, Decls>) {
  for (const p of selectTag(body, 'p')) {
    if (hasAncestor(p, /^(li|td|th|blockquote)$/)) continue;
    const m = PT.exec(javaTrim(declarationsOf(p, classes).get('margin-left') ?? ''));
    if (m && numeric(m[1]!) >= 36) {
      const bq = new El('blockquote');
      replaceWith(p, bq);
      bq.append(p);
    }
  }
}

/** GoogleDocsHtml.normalize: doc.outerHtml() with default (pretty) OutputSettings. */
export function normalize(html: string | null): string | null {
  if (html == null || javaIsBlank(html)) return html;
  const { root, body } = parseDoc(html);
  let css = '';
  for (const s of selectTag(root, 'style')) css += `${s.children.map((c) => (c.kind === 'txt' ? c.value : '')).join('')}\n`;
  const rules = parseCss(css);
  const classes = classDeclarations(rules);
  const types = listTypes(rules);
  for (const el of [...descendants(body)].filter((e) => e.has('class') || e.has('style'))) {
    const d = declarationsOf(el, classes);
    if (d.size === 0) continue;
    align(el, d);
    format(el, d);
  }
  for (const c of [...descendants(body)].filter((e) => ['body', 'td', 'th', 'li'].includes(e.name))) nestLists(c, types);
  indent(body, classes);
  return innerPretty(root);
}

// ================= DocHtmlSanitizer ========================================

const PLACEHOLDER = 'https://drive-asset.invalid/';

/** java.net.URLDecoder.decode(s, UTF_8): '+' -> ' ', throws on a bad '%'. */
export function urlDecode(s: string): string {
  let out = '';
  for (let i = 0; i < s.length;) {
    const c = s[i]!;
    if (c === '+') {
      out += ' ';
      i++;
      continue;
    }
    if (c !== '%') {
      out += c;
      i++;
      continue;
    }
    const bytes: number[] = [];
    while (i < s.length && s[i] === '%') {
      if (i + 3 > s.length) throw new Error('URLDecoder: Incomplete trailing escape (%) pattern');
      const h = s.slice(i + 1, i + 3);
      if (!/^[0-9a-fA-F]{2}$/.test(h)) throw new Error('URLDecoder: Illegal hex characters in escape (%) pattern');
      bytes.push(parseInt(h, 16));
      i += 3;
    }
    out += new TextDecoder().decode(new Uint8Array(bytes));
  }
  return out;
}

/** https://www.google.com/url?q=<target>&sa=... -> <target> (URI.create's host/path/rawQuery, RFC 2396 strictness). */
export function unwrapGoogleRedirect(href: string): string {
  if (/[\u0000- "<>\\^`{|}\u007f]/.test(href) || /%(?![0-9a-fA-F]{2})/.test(href)) return href;
  const m = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?/.exec(href);
  if (!m) return href;
  const host = m[1]!.replace(/^.*@/, '').replace(/:\d*$/, '');
  if (!/^[A-Za-z0-9.-]+$/.test(host) || !host.endsWith('google.com') || m[2] !== '/url' || m[3] == null) return href;
  for (const pair of m[3].split('&')) {
    if (pair.startsWith('q=')) {
      try {
        return urlDecode(pair.slice(2));
      } catch {
        return href;
      }
    }
  }
  return href;
}

// ---- Cleaner with Safelist.relaxed() + addTags("s") + data-align, enforced rel/target on <a>
const TAGS = new Set('a b blockquote br caption cite code col colgroup dd div dl dt em h1 h2 h3 h4 h5 h6 i img li ol p pre q small span strike strong sub sup table tbody td tfoot th thead tr u ul s'.split(' '));
const ATTRS: Record<string, string[]> = {
  a: ['href', 'title'], blockquote: ['cite'], col: ['span', 'width'], colgroup: ['span', 'width'],
  img: ['align', 'alt', 'height', 'src', 'title', 'width'], ol: ['start', 'type'], q: ['cite'],
  table: ['summary', 'width'], td: ['abbr', 'axis', 'colspan', 'rowspan', 'width'],
  th: ['abbr', 'axis', 'colspan', 'rowspan', 'scope', 'width'], ul: ['type'],
};
for (const t of ['p', 'li', 'td', 'th', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']) (ATTRS[t] ??= []).push('data-align');
const PROTOCOLS: Record<string, Record<string, string[]>> = {
  a: { href: ['ftp', 'http', 'https', 'mailto'] }, blockquote: { cite: ['http', 'https'] },
  cite: { cite: ['http', 'https'] }, img: { src: ['http', 'https'] }, q: { cite: ['http', 'https'] },
};
const ENFORCED: Record<string, [string, string][]> = { a: [['rel', 'nofollow noopener noreferrer'], ['target', '_blank']] };

/** java.net.URL(spec).toExternalForm() for the schemes the JDK has handlers for; throws like the JDK. */
function javaUrl(spec: string): string {
  let t = javaTrim(spec);
  if (/^url:/i.test(t)) t = t.slice(4);
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(t);
  if (!m) throw new Error('no protocol');
  const scheme = m[1]!.toLowerCase();
  if (!['http', 'https', 'ftp', 'file', 'jar', 'mailto'].includes(scheme)) throw new Error('unknown protocol');
  let rest = t.slice(m[0].length);
  let ref: string | null = null;
  const hash = rest.indexOf('#');
  if (hash >= 0) {
    ref = rest.slice(hash + 1);
    rest = rest.slice(0, hash);
  }
  if (scheme === 'mailto') return `mailto:${rest}`; // the mailto handler drops the fragment
  let authority: string | null = null;
  if (rest.startsWith('//')) {
    let i = rest.indexOf('/', 2);
    if (i < 0) {
      i = rest.indexOf('?', 2);
      if (i < 0) i = rest.length;
    }
    authority = rest.slice(2, i);
    rest = rest.slice(i);
    let host = authority.slice(authority.lastIndexOf('@') + 1);
    if (host.startsWith('[')) {
      const end = host.indexOf(']');
      if (end <= 2 || !/^[0-9a-fA-F:.]+(%[^\]]+)?$/.test(host.slice(1, end))) throw new Error('Invalid host');
      host = host.slice(end + 1);
      if (host.length && !/^:([+-]?\d*)$/.test(host)) throw new Error('Invalid authority');
    } else {
      const c = host.indexOf(':');
      if (c >= 0 && host.length > c + 1 && !/^[+-]?\d+$/.test(host.slice(c + 1))) throw new Error('bad port');
    }
  }
  // No dot-segment removal: the JDK only does that when resolving against a context URL.
  return `${scheme}:${authority ? `//${authority}` : ''}${rest}${ref != null ? `#${ref}` : ''}`;
}

/** jsoup absUrl with an empty base URI. */
function absUrl(raw: string): string {
  const v = raw.replace(/[\u0000-\u001f]/g, '');
  try {
    return javaUrl(v);
  } catch {
    return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(v) ? v : '';
  }
}

function safeAttr(tag: string, a: [string, string]): boolean {
  const key = a[0];
  if (ATTRS[tag]?.includes(key)) {
    const prots = PROTOCOLS[tag]?.[key];
    if (!prots) return true;
    let v = absUrl(a[1]);
    if (v.length === 0) v = a[1];
    a[1] = v; // preserveRelativeLinks(false): the attribute takes the absolute value
    return prots.some((p) => v.toLowerCase().startsWith(`${p}:`));
  }
  const enf = ENFORCED[tag]?.find((e) => e[0] === key);
  if (enf) return enf[1] === a[1];
  return false;
}

/** Jsoup.clean's Cleaner: safelisted elements/attributes copied, text of dropped elements kept, data dropped. */
function clean(dirty: El): El {
  const out = new El('body');
  const copy = (src: El, dest: El) => {
    for (const n of src.children) {
      if (n.kind === 'el') {
        if (TAGS.has(n.name)) {
          const el = new El(n.name);
          for (const a of n.attrs) {
            const c: [string, string] = [a[0], a[1]];
            if (safeAttr(n.name, c)) el.attrs.push(c);
          }
          for (const [k, v] of ENFORCED[n.name] ?? []) el.set(k, v);
          dest.append(el);
          copy(n, el);
        } else copy(n, dest);
      } else if (n.kind === 'txt' && !n.data) dest.append(new Txt(n.value));
    }
  };
  copy(dirty, out);
  return out;
}

export interface SanitizedDoc { html: string; text: string; usedAssets: string[] }

/**
 * DocHtmlSanitizer.sanitize. srcToAsset: image src as written in the export
 * ("images/image1.png") -> stored asset name; assetUrlPrefix e.g.
 * "/api/v1/wiki/files/<id>/assets/". Throws like Java when an img src has a
 * malformed %-escape (URLDecoder), which fails the whole Doc.
 */
export function sanitize(raw: string | null, srcToAsset: ReadonlyMap<string, string>, prefix: string): SanitizedDoc {
  const { root, body } = parseDoc(raw ?? '');
  for (const img of selectTag(root, 'img')) {
    const src = img.attr('src');
    const asset = srcToAsset.get(src) ?? srcToAsset.get(urlDecode(src));
    if (asset == null) detach(img);
    else img.set('src', PLACEHOLDER + asset);
  }
  for (const a of selectTag(root, 'a').filter((e) => e.has('href'))) a.set('href', unwrapGoogleRedirect(a.attr('href')));
  const bodyHtml = innerPretty(body); // doc.body().html(), pretty print ON
  const cleaned = innerCompact(clean(parseBodyFragment(bodyHtml))); // Jsoup.clean(..., prettyPrint(false))
  const out = parseBodyFragment(cleaned);
  const values = new Set(srcToAsset.values());
  const used: string[] = [];
  for (const img of selectTag(out, 'img')) {
    const src = img.attr('src');
    if (!src.startsWith(PLACEHOLDER)) {
      detach(img);
      continue;
    }
    const name = src.slice(PLACEHOLDER.length);
    if (!values.has(name)) {
      detach(img);
      continue;
    }
    img.set('src', prefix + name);
    if (!used.includes(name)) used.push(name);
  }
  return { html: innerCompact(out), text: text(out), usedAssets: used };
}

/** sanitize(normalize(raw)): what DriveContentProcessor.parseDoc runs. */
export const pipeline = (raw: string | null, assets: ReadonlyMap<string, string>, prefix: string) => sanitize(normalize(raw), assets, prefix);
