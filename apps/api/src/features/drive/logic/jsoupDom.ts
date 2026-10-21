// The slice of jsoup (1.21) that GoogleDocsHtml and DocHtmlSanitizer use,
// on top of linkedom: Jsoup.parse / parseBodyFragment, compact html()
// serialization, Element.text(), select-with-self, Safelist.relaxed cleaning.
//
// Known differences from jsoup (documented, not emulated):
//   - linkedom's tree builder is not the HTML5 algorithm, so malformed markup
//     (misnested formatting, stray table content, foster parenting) can end
//     up in a different tree. Inputs here are Google Docs exports (well formed).
//   - html() is always the compact form. Java pretty-prints twice
//     (GoogleDocsHtml.normalize's outerHtml() and DocHtmlSanitizer's
//     doc.body().html() before cleaning), so the sanitized HTML differs from
//     Java's by the newlines/indentation between block tags, and so does the
//     Doc content fingerprint DriveContentProcessor hashes from it.

import { parseHTML } from 'linkedom';

// Head-only elements jsoup keeps in <head> when they come before any content.
const HEAD_TAGS = /^(?:style|title|meta|link|base|script|noscript)$/i;

/** Splits a document string into head and body markup, the way jsoup's tree builder places them. */
function splitDocument(html: string): { head: string; body: string } {
  let s = html.replace(/<!doctype[^>]*>/i, '');
  const bodyOpen = /<body(?:\s[^>]*)?>/i.exec(s);
  if (bodyOpen) {
    const head = s.slice(0, bodyOpen.index).replace(/<\/?(?:html|head)(?:\s[^>]*)?>/gi, '');
    let body = s.slice(bodyOpen.index + bodyOpen[0].length);
    body = body.replace(/<\/body\s*>/i, '').replace(/<\/html\s*>/i, '');
    return { head, body };
  }
  s = s.replace(/<\/?(?:html|head)(?:\s[^>]*)?>/gi, '');
  // Leading head elements (and whitespace/comments) go to <head>.
  let head = '';
  for (;;) {
    const m = /^(\s*(?:<!--[\s\S]*?-->\s*)*)<([a-zA-Z]+)(?:\s[^>]*)?>/.exec(s);
    if (!m || !HEAD_TAGS.test(m[2]!)) break;
    const tag = m[2]!.toLowerCase();
    const close = new RegExp(`</${tag}\\s*>`, 'i');
    const isVoid = /^(?:meta|link|base)$/.test(tag);
    let end = m[0].length;
    if (!isVoid) {
      const c = close.exec(s.slice(end));
      end = c ? end + c.index + c[0].length : s.length;
    }
    head += s.slice(0, end);
    s = s.slice(end);
  }
  return { head, body: s };
}

/** Jsoup.parse(html): a full document (html/head/body always present). */
export function parseDocument(html: string): Document {
  const { head, body } = splitDocument(html);
  const { document } = parseHTML(`<!DOCTYPE html><html><head>${head}</head><body>${body}</body></html>`);
  insertTbody(document as unknown as Document);
  return document as unknown as Document;
}

/** Jsoup.parseBodyFragment(html). */
export function parseBodyFragment(html: string): Document {
  const { document } = parseHTML(`<!DOCTYPE html><html><head></head><body>${html}</body></html>`);
  insertTbody(document as unknown as Document);
  return document as unknown as Document;
}

/** The HTML5 tree builder wraps a table's direct <tr> runs in <tbody>; linkedom does not. */
function insertTbody(doc: Document): void {
  for (const table of [...doc.querySelectorAll('table')]) {
    let tbody: Element | null = null;
    for (const child of [...table.childNodes]) {
      if (child.nodeType === 1 && (child as Element).localName === 'tr') {
        if (!tbody) {
          tbody = doc.createElement('tbody');
          table.insertBefore(tbody, child);
        }
        tbody.appendChild(child);
      } else if (child.nodeType === 1) {
        tbody = null;
      }
    }
  }
}

/** Element.select(css): like jsoup, the element itself is included when it matches. */
export function selectWithSelf(el: Element, css: string): Element[] {
  const out = [...el.querySelectorAll(css)];
  return el.matches(css) ? [el, ...out] : out;
}

export const normalName = (el: Element): string => el.localName.toLowerCase();

/** Element.children() (elements only). */
export const childElements = (el: Element): Element[] => [...el.children];

/** Element.classNames(): whitespace-split class attribute, in order, distinct. */
export function classNames(el: Element): string[] {
  const c = el.getAttribute('class');
  if (c == null) return [];
  return [...new Set(c.split(/[ \t\n\f\r]+/).filter((x) => x.length > 0))];
}

const isActuallyWhitespace = (c: number) => c === 32 || c === 9 || c === 10 || c === 12 || c === 13 || c === 160;
const isInvisible = (c: number) => c === 8203 || c === 173;

/** jsoup TextNode.isBlank / StringUtil.isBlank: only ' ', \t, \n, \f, \r. */
function isBlankText(s: string): boolean {
  return /^[ \t\n\f\r]*$/.test(s);
}

/** Element.hasText(): some descendant text node is not blank. */
export function hasText(el: Element): boolean {
  const walker = (n: Node): boolean => {
    for (const c of [...n.childNodes]) {
      if (c.nodeType === 3 && !isBlankText(c.nodeValue ?? '')) return true;
      if (c.nodeType === 1 && walker(c)) return true;
    }
    return false;
  };
  return walker(el);
}

// jsoup Tag: block tags, and those of them formatted as inline.
const BLOCK = new Set(['html', 'head', 'body', 'frameset', 'script', 'noscript', 'style', 'meta', 'link', 'title', 'frame',
  'noframes', 'section', 'nav', 'aside', 'hgroup', 'header', 'footer', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol',
  'pre', 'div', 'blockquote', 'hr', 'address', 'figure', 'figcaption', 'form', 'fieldset', 'ins', 'del', 'dl', 'dt', 'dd',
  'li', 'table', 'caption', 'thead', 'tfoot', 'tbody', 'colgroup', 'col', 'tr', 'th', 'td', 'video', 'audio', 'canvas',
  'details', 'menu', 'plaintext', 'template', 'article', 'main', 'svg', 'math', 'center', 'dir', 'applet', 'marquee', 'listing']);
const FORMAT_AS_INLINE = new Set(['title', 'a', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'address', 'li', 'th', 'td',
  'script', 'style', 'ins', 'del', 's', 'button']);
const PRESERVE_WS = new Set(['pre', 'plaintext', 'title', 'textarea']);

const isBlock = (el: Element) => BLOCK.has(normalName(el));
const formatAsBlock = (el: Element) => isBlock(el) && !FORMAT_AS_INLINE.has(normalName(el));

function preservesWhitespace(n: Node | null): boolean {
  for (let p = n; p != null && p.nodeType === 1; p = p.parentNode) {
    if (PRESERVE_WS.has(normalName(p as Element))) return true;
  }
  return false;
}

/** Element.text(): normalized, block boundaries as spaces, trimmed. */
export function text(el: Element): string {
  let acc = '';
  const lastIsWs = () => acc.length > 0 && acc[acc.length - 1] === ' ';
  const appendNormalised = (s: string) => {
    let lastWasWhite = false;
    let reachedNonWhite = false;
    const stripLeading = lastIsWs();
    for (const ch of s) {
      const c = ch.codePointAt(0)!;
      if (isActuallyWhitespace(c)) {
        if ((stripLeading && !reachedNonWhite) || lastWasWhite) continue;
        acc += ' ';
        lastWasWhite = true;
      } else if (!isInvisible(c)) {
        acc += ch;
        lastWasWhite = false;
        reachedNonWhite = true;
      }
    }
  };
  const visit = (n: Node) => {
    if (n.nodeType === 3) {
      if (preservesWhitespace(n.parentNode)) acc += n.nodeValue ?? '';
      else appendNormalised(n.nodeValue ?? '');
      return;
    }
    if (n.nodeType !== 1) return;
    const e = n as Element;
    if (acc.length > 0 && (isBlock(e) || normalName(e) === 'br') && !lastIsWs()) acc += ' ';
    for (const c of [...e.childNodes]) visit(c);
    const next = e.nextSibling;
    if (isBlock(e) && (next?.nodeType === 3 || (next?.nodeType === 1 && !formatAsBlock(next as Element))) && !lastIsWs()) acc += ' ';
  };
  for (const c of [...el.childNodes]) visit(c);
  return acc.replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, '');
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'keygen', 'link', 'meta', 'param',
  'source', 'track', 'wbr', 'basefont', 'bgsound', 'frame', 'command', 'device', 'menuitem']);
const DATA = new Set(['script', 'style']);
// jsoup's collapsible boolean attributes (printed without a value when the value is empty or equals the name).
const BOOLEAN_ATTRS = new Set(['allowfullscreen', 'async', 'autofocus', 'checked', 'compact', 'declare', 'default', 'defer',
  'disabled', 'formnovalidate', 'hidden', 'inert', 'ismap', 'itemscope', 'multiple', 'muted', 'nohref', 'noresize',
  'noshade', 'novalidate', 'nowrap', 'open', 'readonly', 'required', 'reversed', 'seamless', 'selected', 'sortable',
  'truespeed', 'typemustmatch']);

/** jsoup Entities.escape (base mode, UTF-8): text vs attribute value. */
export function escapeHtml(s: string, inAttribute: boolean): string {
  let out = '';
  for (const ch of s) {
    switch (ch) {
      case '&': out += '&amp;'; break;
      case '\u00A0': out += '&nbsp;'; break;
      case '<': out += '&lt;'; break;
      case '>': out += '&gt;'; break;
      case '"': out += inAttribute ? '&quot;' : ch; break;
      default: out += ch;
    }
  }
  return out;
}

function serializeNode(n: Node): string {
  if (n.nodeType === 3) {
    const parent = n.parentNode as Element | null;
    if (parent && parent.nodeType === 1 && DATA.has(normalName(parent))) return n.nodeValue ?? '';
    return escapeHtml(n.nodeValue ?? '', false);
  }
  if (n.nodeType === 8) return `<!--${n.nodeValue ?? ''}-->`;
  if (n.nodeType !== 1) return '';
  const el = n as Element;
  const tag = normalName(el);
  let out = `<${tag}`;
  for (const a of [...el.attributes]) {
    const name = a.name.toLowerCase();
    if (BOOLEAN_ATTRS.has(name) && (a.value === '' || a.value.toLowerCase() === name)) out += ` ${name}`;
    else out += ` ${name}="${escapeHtml(a.value, true)}"`;
  }
  out += '>';
  if (VOID.has(tag)) return out;
  for (const c of [...el.childNodes]) out += serializeNode(c);
  return `${out}</${tag}>`;
}

/** Element.html() with prettyPrint(false). */
export function innerHtml(el: Element): string {
  return [...el.childNodes].map(serializeNode).join('');
}

/** Document.outerHtml(), compact. */
export function documentHtml(doc: Document): string {
  return `<!doctype html>${serializeNode(doc.documentElement)}`;
}

/** Element.wrap(html) for a bare tag name. */
export function wrap(el: Element, tag: string): void {
  const w = el.ownerDocument.createElement(tag);
  el.parentNode!.insertBefore(w, el);
  w.appendChild(el);
}

/**
 * Element.attr(key, value) with jsoup's ordering: an existing attribute keeps
 * its place, a new one goes last (linkedom's setAttribute prepends new ones).
 */
export function setAttr(el: Element, key: string, value: string): void {
  if (el.hasAttribute(key)) {
    el.setAttribute(key, value);
    return;
  }
  const existing = [...el.attributes].map((a) => [a.name, a.value] as const);
  for (const [n] of existing) el.removeAttribute(n);
  el.setAttribute(key, value);
  for (let i = existing.length - 1; i >= 0; i--) el.setAttribute(existing[i]![0], existing[i]![1]);
}
