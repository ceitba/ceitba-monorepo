// Port of apps/api/src/main/java/org/ceitba/api/service/drive/GoogleDocsHtml.java.
//
// Turns the HTML of a Google Docs export into plain semantic HTML BEFORE
// DocHtmlSanitizer strips every class and style:
//   formatting  font-weight:700 / font-style:italic / text-decoration:
//               underline|line-through / vertical-align:super|sub
//               -> <strong> <em> <u> <s> <sup> <sub> inside the element
//   alignment   text-align:center|right -> data-align="center|right"
//   lists       flat <ul>/<ol> runs with class lst-kix_<id>-<N> -> real nested
//               lists, <ol type>, and `start` when numbering continues
//   indents     a paragraph (outside lists) with margin-left >= 36pt -> <blockquote>
// Class rules from the <style> sheet and inline style attributes are both read.
// Returns compact HTML (jsoup pretty-prints here; see jsoupDom.ts).

import { childElements, classNames, documentHtml, hasText, normalName, parseDocument, selectWithSelf, setAttr, wrap } from './jsoupDom';
import { javaIsBlank, javaSplit, javaTrim } from '../../../lib/javaCompat';

const RULE = /([^{}]+)\{([^{}]*)\}/g;
const IMPORT = /@import[^;]*;/g;
const CLASS_SELECTOR = /^(?:[a-z0-9]+)?\.([A-Za-z0-9_-]+)$/;
const LIST_CLASS = /^lst-kix_(.+)-(\d+)$/;
const LIST_BEFORE = /^\.(lst-kix_.+-\d+)[ \t\n\x0B\f\r]*>[ \t\n\x0B\f\r]*li:before$/;
const LIST_SELECTOR = /^(?:ol|ul)?\.(lst-kix_.+-\d+)$/;
const COUNTER_STYLE = /counter\([^,)]+,[ \t\n\x0B\f\r]*([a-z-]+)[ \t\n\x0B\f\r]*\)/;
const PT = /^(-?[0-9.]+)pt$/;

type Decls = Map<string, string>;

export function normalizeGoogleDocsHtml(html: string | null): string | null {
  if (html == null || javaIsBlank(html)) return html;
  const doc = parseDocument(html);
  let css = '';
  for (const style of [...doc.querySelectorAll('style')]) css += `${style.textContent ?? ''}\n`;
  const rules = parseCss(css);
  const classes = classDeclarations(rules);
  const types = listTypes(rules);

  for (const el of selectWithSelf(doc.body, '[class], [style]')) {
    const decls = declarationsOf(el, classes);
    if (decls.size === 0) continue;
    align(el, decls);
    format(el, decls);
  }
  for (const container of selectWithSelf(doc.body, 'body, td, th, li')) nestLists(container, types);
  indent(doc.body, classes);
  return documentHtml(doc);
}

// ---- CSS

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
    for (const selector of javaSplit(m[1]!, /,/)) {
      const key = javaTrim(selector);
      let target = out.get(key);
      if (!target) out.set(key, (target = new Map()));
      for (const [k, v] of decls) target.set(k, v);
    }
  }
  return out;
}

function classDeclarations(rules: Map<string, Decls>): Map<string, Decls> {
  const out = new Map<string, Decls>();
  for (const [selector, decls] of rules) {
    const m = CLASS_SELECTOR.exec(selector);
    if (!m) continue;
    let target = out.get(m[1]!);
    if (!target) out.set(m[1]!, (target = new Map()));
    for (const [k, v] of decls) target.set(k, v);
  }
  return out;
}

/** list class (lst-kix_<id>-<N>) -> CSS list style (decimal, lower-latin, disc...). */
function listTypes(rules: Map<string, Decls>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [selector, decls] of rules) {
    const before = LIST_BEFORE.exec(selector);
    if (before) {
      const counter = COUNTER_STYLE.exec(decls.get('content') ?? '');
      if (counter) out.set(before[1]!, counter[1]!);
      continue;
    }
    const list = LIST_SELECTOR.exec(selector);
    const type = decls.get('list-style-type');
    if (list && type != null && type !== 'none' && !out.has(list[1]!)) out.set(list[1]!, type);
  }
  return out;
}

/** Class rules, then the inline style. */
function declarationsOf(el: Element, classes: Map<string, Decls>): Decls {
  const out: Decls = new Map();
  for (const c of classNames(el)) {
    const decls = classes.get(c);
    if (decls) for (const [k, v] of decls) out.set(k, v);
  }
  const style = el.getAttribute('style');
  if (style != null) {
    for (const d of javaSplit(style, /;/)) {
      const colon = d.indexOf(':');
      if (colon > 0) out.set(javaTrim(d.slice(0, colon)).toLowerCase(), javaTrim(d.slice(colon + 1)));
    }
  }
  return out;
}

// ---- inline formatting and alignment

function format(el: Element, decls: Decls): void {
  const tag = normalName(el);
  if (!['span', 'p', 'li', 'td', 'th'].includes(tag)) return;
  if (!hasText(el) && selectWithSelf(el, 'img').length === 0) return;
  const inHeading = /^h[1-6]$/.test(tag) || hasAncestor(el, /^(?:h1|h2|h3|h4|h5|h6)$/);
  const inLink = hasAncestor(el, /^a$/) || selectWithSelf(el, 'a').length > 0;

  const weight = decls.get('font-weight') ?? '';
  const bold = !inHeading && (weight === 'bold' || weight === 'bolder' || numeric(weight) >= 600);
  const italic = (decls.get('font-style') ?? '').includes('italic');
  const decoration = `${decls.get('text-decoration') ?? ''} ${decls.get('text-decoration-line') ?? ''}`;
  const underline = !inLink && decoration.includes('underline');
  const strike = decoration.includes('line-through');
  const valign = decls.get('vertical-align') ?? '';

  // Innermost first, so the result reads <strong><em>...</em></strong>.
  if (valign === 'super') wrapContents(el, 'sup');
  if (valign === 'sub') wrapContents(el, 'sub');
  if (strike) wrapContents(el, 's');
  if (underline) wrapContents(el, 'u');
  if (italic) wrapContents(el, 'em');
  if (bold) wrapContents(el, 'strong');
}

function align(el: Element, decls: Decls): void {
  const a = decls.get('text-align') ?? '';
  if (!(a === 'center' || a === 'right')) return;
  if (/^(?:p|h[1-6]|li|td|th|div)$/.test(normalName(el))) setAttr(el, 'data-align', a);
}

function hasAncestor(el: Element, tag: RegExp): boolean {
  for (let p = el.parentElement; p != null; p = p.parentElement) if (tag.test(normalName(p))) return true;
  return false;
}

function wrapContents(el: Element, tag: string): void {
  const wrapper = el.ownerDocument.createElement(tag);
  for (const node of [...el.childNodes]) wrapper.appendChild(node);
  el.appendChild(wrapper);
}

/** Double.parseDouble, 0 when not a number. */
function numeric(s: string): number {
  const t = javaTrim(s);
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?[fFdD]?$/.test(t)) return 0;
  return Number(t.replace(/[fFdD]$/, ''));
}

// ---- lists

interface ListInfo { id: string; level: number; listClass: string }
interface Open { info: ListInfo; list: Element }

function listInfo(el: Element): ListInfo | null {
  const tag = normalName(el);
  if (!(tag === 'ul' || tag === 'ol')) return null;
  for (const c of classNames(el)) {
    const m = LIST_CLASS.exec(c);
    if (m) return { id: m[1]!, level: Number(m[2]), listClass: c };
  }
  return null;
}

const lis = (el: Element) => childElements(el).filter((c) => normalName(c) === 'li');
const hasClass = (el: Element, c: string) => classNames(el).some((x) => x.toLowerCase() === c.toLowerCase());

/** Rebuilds nesting among the direct children of `container`. */
function nestLists(container: Element, types: Map<string, string>): void {
  const stack: Open[] = []; // top = stack[0] (ArrayDeque push/peek/pop)
  const counts = new Map<string, number>();
  for (const child of childElements(container)) {
    if (child.parentNode !== container) continue; // already moved
    const info = listInfo(child);
    if (info == null) {
      stack.length = 0;
      continue;
    }
    const ordered = normalName(child) === 'ol';
    const cssType = types.get(info.listClass);
    if (ordered) {
      const type = olType(cssType ?? null);
      if (type != null) setAttr(child, 'type', type);
    }
    if (hasClass(child, 'start')) counts.set(info.listClass, 0);

    while (stack.length > 0 && stack[0]!.info.level > info.level) stack.shift();
    let top = stack[0];
    if (top && top.info.level === info.level) {
      if (top.info.id === info.id && normalName(top.list) === normalName(child)) {
        const items = lis(child);
        for (const it of items) top.list.appendChild(it);
        counts.set(info.listClass, (counts.get(info.listClass) ?? 0) + items.length);
        child.remove();
        continue;
      }
      stack.shift();
      top = stack[0];
    }
    if (ordered && !child.hasAttribute('start')) {
      const seen = counts.get(info.listClass) ?? 0;
      if (seen > 0) setAttr(child, 'start', String(seen + 1));
    }
    counts.set(info.listClass, (counts.get(info.listClass) ?? 0) + lis(child).length);
    if (top && top.info.level < info.level) {
      const items = lis(top.list);
      if (items.length > 0) items[items.length - 1]!.appendChild(child);
    }
    stack.unshift({ info, list: child });
  }
}

export function olType(cssType: string | null): string | null {
  switch (cssType) {
    case 'decimal': case 'decimal-leading-zero': return '1';
    case 'lower-latin': case 'lower-alpha': return 'a';
    case 'upper-latin': case 'upper-alpha': return 'A';
    case 'lower-roman': return 'i';
    case 'upper-roman': return 'I';
    default: return null;
  }
}

// ---- indented paragraphs

function indent(body: Element, classes: Map<string, Decls>): void {
  for (const p of selectWithSelf(body, 'p')) {
    if (hasAncestor(p, /^(?:li|td|th|blockquote)$/)) continue;
    const margin = declarationsOf(p, classes).get('margin-left') ?? '';
    const m = PT.exec(javaTrim(margin));
    if (m && numeric(m[1]!) >= 36) wrap(p, 'blockquote');
  }
}

/** For tests: the selectors parsed from a style sheet. */
export function cssSelectors(css: string): string[] {
  return [...parseCss(css).keys()];
}
