// jsoup 1.21.2's printer and Element.text(), ported from the spike
// (docs/plans/api-bun-spikes.md §4; .spikes-archive/html/jsoupish.ts): escapeMode
// base, UTF-8, html syntax, prettyPrint(false) (`compact`) and the default pretty
// print (indent 1, max padding 30; `innerPretty`). The tag classes were derived
// from jsoup's behaviour and pinned by 1,834 Java goldens
// (test/drive/fixtures/html/goldens), not read from jsoup's sources. A jsoup
// upgrade on the Java side would change those bytes too: keep them frozen.

import { Cmt, El, type Node } from './dom';

const BLOCK = new Set(('address applet article aside audio blockquote body br button canvas caption center colgroup dd '
  + 'del details dir div dl dt fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 head header hgroup hr html ins li '
  + 'link listing main marquee math menu meta nav noframes noscript ol p plaintext pre script section style svg table '
  + 'tbody td template tfoot th thead title tr ul video frameset frame col').split(' '));
export const INLINE_CONTAINER = new Set('address button del h1 h2 h3 h4 h5 h6 ins li p pre script style title td th plaintext'.split(' '));
const VOID = new Set('area base basefont bgsound br col command embed frame hr img input keygen link meta param source track wbr'.split(' '));
export const PRESERVE_WS = new Set(['pre', 'plaintext', 'title', 'textarea']);
const KNOWN = new Set([...BLOCK, ...('a abbr acronym area b base basefont bdi bdo bgsound big blink cite code command data datalist '
  + 'dfn dialog em embed font i iframe img input kbd keygen label legend map mark menuitem meter nobr noembed object '
  + 'optgroup option output param picture progress q rb rp rt rtc ruby s samp search select slot small source span '
  + 'strike strong sub summary sup textarea time track tt u var wbr xmp').split(' ')]);
const BOOLEAN_ATTRS = new Set(('allowfullscreen async autofocus checked compact controls declare default defer disabled '
  + 'formnovalidate hidden inert ismap itemscope multiple muted nohref noresize noshade novalidate nowrap open readonly '
  + 'required reversed seamless selected sortable truespeed typemustmatch').split(' '));

export const isBlock = (el: El) => BLOCK.has(el.name);
/** An HTML element jsoup knows (unknown tags printed as <x /> when self-closed in the source). */
export const isKnownHtml = (name: string, ns: string) => ns === 'http://www.w3.org/1999/xhtml' && KNOWN.has(name);

const leaf = (n: Cmt) => n.raw ?? `<!--${n.value}-->`;

/** Entities.escape (base mode, UTF-8): text (inAttr false) or attribute value. */
export function escape(s: string, inAttr: boolean): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === '&') out += '&amp;';
    else if (c === 0xa0) out += '&nbsp;';
    else if (ch === '<') out += '&lt;';
    else if (ch === '>') out += '&gt;';
    else if (ch === '"' && inAttr) out += '&quot;';
    else if (c < 0x20 && c !== 9 && c !== 10 && c !== 13) out += `&#x${c.toString(16)};`;
    else if (c >= 0xd800 && c <= 0xdfff) out += `&#x${c.toString(16)};`; // lone surrogate: UTF-8 cannot encode it
    else out += ch;
  }
  return out;
}

/** Pretty-print text normalisation: whitespace runs -> one space, optional trims (nbsp is not whitespace). */
function normaliseText(s: string, trimLeading: boolean, trimTrailing: boolean): string {
  let out = '';
  let lastWhite = false;
  let reachedNonWhite = false;
  let skipped = false;
  for (const ch of s) {
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\f' || ch === '\r') {
      if (trimLeading && !reachedNonWhite) continue;
      if (lastWhite) continue;
      if (trimTrailing) {
        skipped = true;
        lastWhite = true;
        continue;
      }
      out += ' ';
      lastWhite = true;
      continue;
    }
    if (skipped) {
      out += ' ';
      skipped = false;
    }
    lastWhite = false;
    reachedNonWhite = true;
    out += escape(ch, false);
  }
  return out;
}

function head(el: El): string {
  let s = `<${el.name}`;
  for (const [k, v] of el.attrs) {
    s += ` ${k}`;
    if (!((v === '' || v.toLowerCase() === k) && BOOLEAN_ATTRS.has(k))) s += `="${escape(v, true)}"`;
  }
  return `${s}>`;
}

// ---- compact (prettyPrint false) -----------------------------------------------

export function compact(n: Node): string {
  if (n.kind === 'txt') return n.cdata ? `<![CDATA[${n.value}]]>` : n.data ? n.value : escape(n.value, false);
  if (n.kind === 'cmt') return leaf(n);
  if (VOID.has(n.name)) return head(n);
  if (n.selfClosing) return `${head(n).slice(0, -1)} />`;
  return head(n) + n.children.map(compact).join('') + `</${n.name}>`;
}

/** Element.html() with prettyPrint(false). */
export const innerCompact = (el: El) => el.children.map(compact).join('');

// ---- pretty (default OutputSettings: indentAmount 1, maxPaddingWidth 30) ----

const isBlankTxt = (n: Node | null | undefined) => !!n && n.kind === 'txt' && /^[ \t\n\f\r]*$/.test(n.value);
const prevSib = (n: Node) => {
  const s = n.parent!.children;
  return s[s.indexOf(n) - 1] ?? null;
};
const nextSib = (n: Node) => {
  const s = n.parent!.children;
  return s[s.indexOf(n) + 1] ?? null;
};
function prevNonBlank(n: Node): Node | null {
  let p = prevSib(n);
  while (p && isBlankTxt(p)) p = prevSib(p);
  return p;
}
function nextNonBlank(n: Node | null): Node | null {
  let p = n;
  while (p && isBlankTxt(p)) p = nextSib(p);
  return p;
}
const hasChildBlocks = (el: El): boolean => el.elements().some((c) => isBlock(c) || hasChildBlocks(c));
function isBlockEl(n: Node | null): boolean {
  if (!n || n.kind !== 'el') return false;
  return isBlock(n) || (!KNOWN.has(n.name) && (n.parent?.name === '#root' || hasChildBlocks(n)));
}

/** Element.html() / Document.outerHtml() with the default (pretty) OutputSettings. */
export function innerPretty(root: El): string {
  let out = '';
  let preserve = false;
  const indent = (depth: number) => {
    out += `\n${' '.repeat(Math.min(depth, 30))}`;
  };
  const shouldIndent = (n: Node | null): boolean => {
    if (!n || n === root || preserve || isBlankTxt(n)) return false;
    if (n.parent === root && root.children[0] === n) return false; // the output never starts with a newline
    if (isBlockEl(n)) return true;
    const prev = prevNonBlank(n);
    if (isBlockEl(prev)) return true;
    const parent = n.parent!;
    if (!isBlockEl(parent) || INLINE_CONTAINER.has(parent.name) || !parent.children.some((c) => c.kind !== 'txt')) return false;
    return prev === null || (prev.kind !== 'txt' && (isBlockEl(prev) || prev.kind !== 'el'));
  };
  const visit = (n: Node, depth: number) => {
    if (n.kind === 'el') {
      if (shouldIndent(n)) indent(depth);
      if (n.selfClosing) {
        out += `${head(n).slice(0, -1)} />`;
        return;
      }
      out += head(n);
      if (VOID.has(n.name)) return;
      const wasPreserve = preserve;
      if (PRESERVE_WS.has(n.name)) preserve = true;
      for (const c of [...n.children]) visit(c, depth + 1);
      if (shouldIndent(nextNonBlank(n.children[0] ?? null))) indent(depth);
      out += `</${n.name}>`;
      preserve = wasPreserve;
    } else if (n.kind === 'cmt') {
      if (shouldIndent(n)) indent(depth);
      out += leaf(n);
    } else if (n.cdata) {
      if (shouldIndent(n)) indent(depth);
      out += `<![CDATA[${n.value}]]>`;
    } else if (n.data) {
      if (shouldIndent(n)) indent(depth);
      out += n.value;
    } else if (preserve) {
      out += escape(n.value, false);
    } else {
      const parent = n.parent!;
      let tl = false;
      let tt = false;
      if (isBlockEl(parent)) {
        const p = prevSib(n);
        const x = nextSib(n);
        tl = p === null || ((p.kind === 'cmt' || isBlockEl(p)) && shouldIndent(p));
        tt = x === null || shouldIndent(x);
      }
      if (!isBlankTxt(n) && isBlockEl(parent) && shouldIndent(n)) indent(depth);
      out += normaliseText(n.value, tl, tt);
    }
  };
  for (const c of [...root.children]) visit(c, 0);
  return javaTrim(out);
}

// ---- Element.text() ------------------------------------------------------------

export function text(root: El): string {
  let acc = '';
  const lastWs = () => acc.length > 0 && acc[acc.length - 1] === ' ';
  const preserveWs = (el: El | null) => {
    for (let i = 0; el && i < 6; i++, el = el.parent) if (PRESERVE_WS.has(el.name)) return true;
    return false;
  };
  const walk = (n: Node) => {
    if (n.kind === 'txt') {
      if (n.data) return;
      if (preserveWs(n.parent) || n.cdata) {
        acc += n.value;
        return;
      }
      let lastWasWhite = false;
      let reached = false;
      const strip = lastWs();
      for (const ch of n.value) {
        const c = ch.codePointAt(0)!;
        if (c === 32 || c === 9 || c === 10 || c === 12 || c === 13 || c === 160) {
          if ((strip && !reached) || lastWasWhite) continue;
          acc += ' ';
          lastWasWhite = true;
        } else if (c !== 8203 && c !== 173) {
          acc += ch;
          lastWasWhite = false;
          reached = true;
        }
      }
      return;
    }
    if (n.kind !== 'el') return;
    if (acc.length > 0 && (isBlock(n) || n.name === 'br') && !lastWs()) acc += ' ';
    for (const c of [...n.children]) walk(c);
    const next = n.parent ? nextSib(n) : null;
    if (isBlock(n) && (next?.kind === 'txt' || (next?.kind === 'el' && !(isBlock(next) && !INLINE_CONTAINER.has(next.name)))) && !lastWs()) acc += ' ';
  };
  walk(root);
  return javaTrim(acc);
}

/** Java String.trim(): strips chars <= U+0020 at both ends. */
export function javaTrim(s: string): string {
  let a = 0;
  let b = s.length;
  while (a < b && s.charCodeAt(a) <= 32) a++;
  while (b > a && s.charCodeAt(b - 1) <= 32) b--;
  return s.slice(a, b);
}
