// Tree builders for the jsoup port: Jsoup.parse(html) and
// Jsoup.parseBodyFragment(html) into the tiny DOM (dom.ts).
//
// - parse5 (an HTML5 tree builder, like jsoup's): the spike's builder, 1,832 of
//   1,834 Java goldens byte-identical (the 2 others are malformed tag soup).
//   A dependency of apps/api; useParse5() swaps it (tests).
// - linkedom: the fallback when useParse5(null). It is not an HTML5 tree builder
//   (src/features/drive/logic/jsoupDom.ts lists what it gets wrong), so
//   malformed or unusual markup can end up in a different tree; the printer on
//   top is the same. Its score on the goldens is recorded in docs/DRIVE-PARITY.md.

import * as parse5Module from 'parse5';
import { parseBodyFragment as linkedomFragment, parseDocument as linkedomDocument } from '../jsoupDom';
import { Cmt, detach, El, Txt } from './dom';
import { isKnownHtml } from './print';

/** Elements whose content jsoup keeps as DataNode (never escaped, never text()). */
const DATA = new Set(['script', 'style', 'xmp', 'iframe', 'noembed', 'noframes']);

export interface Parse5Like {
  parse(html: string, opts?: Record<string, unknown>): unknown;
  parseFragment(ctx: unknown, html: string, opts?: Record<string, unknown>): unknown;
}

// A static import: a top-level `await import()` here delays the content Worker's module evaluation, and the pool's
// first messages arrive before `self.onmessage` is set and are lost (the Worker then hangs).
let parse5: Parse5Like | null = parse5Module as unknown as Parse5Like;

/** Uses this parse5 module as the tree builder (tests; or once parse5 is a dependency it loads by itself). */
export function useParse5(mod: Parse5Like | null): void {
  parse5 = mod;
}

/** Which tree builder is in use. */
export function treeBuilder(): 'parse5' | 'linkedom' {
  return parse5 ? 'parse5' : 'linkedom';
}

export interface ParsedDoc { root: El; head: El; body: El }

/** Jsoup.parse(html): the document root (#root > html > head, body). */
export function parseDoc(html: string): ParsedDoc {
  return parse5 ? parse5Doc(parse5, html) : linkedomDoc(html);
}

/** Jsoup.parseBodyFragment(html): a body holding the fragment parsed in body context. */
export function parseBodyFragment(html: string): El {
  return parse5 ? parse5Fragment(parse5, html) : linkedomFrag(html);
}

// ---------------------------------------------------------------- parse5

interface P5Node {
  nodeName: string;
  tagName?: string;
  namespaceURI?: string;
  value?: string;
  data?: string;
  name?: string;
  publicId?: string;
  systemId?: string;
  attrs?: { name: string; value: string; prefix?: string }[];
  childNodes?: P5Node[];
  content?: P5Node;
  sourceCodeLocation?: { startTag?: { startOffset: number; endOffset: number }; endTag?: { startOffset: number } };
}

function convertP5(p5: P5Node, parent: El, src?: string): void {
  for (const c of p5.childNodes ?? []) {
    if (c.nodeName === '#text') parent.append(new Txt(c.value!, DATA.has(parent.name)));
    // jsoup keeps <![CDATA[..]]> in HTML as a CDataNode (a TextNode); parse5 makes it a bogus comment.
    else if (c.nodeName === '#comment' && /^\[CDATA\[[\s\S]*\]\]$/.test(c.data!)) parent.append(new Txt(c.data!.slice(7, -2), false, true));
    else if (c.nodeName === '#comment') parent.append(new Cmt(c.data!));
    else if (c.nodeName === '#documentType') {
      parent.append(new Cmt('', `<!doctype ${c.name}${c.publicId ? ` PUBLIC "${c.publicId}"` : ''}${c.systemId ? ` "${c.systemId}"` : ''}>`));
    } else if (c.tagName) {
      const el = new El(c.tagName, (c.attrs ?? []).map((a) => [a.prefix ? `${a.prefix}:${a.name}` : a.name, a.value] as [string, string]));
      const st = c.sourceCodeLocation?.startTag;
      if (src && st && !isKnownHtml(c.tagName, c.namespaceURI ?? '') && src.slice(st.startOffset, st.endOffset).endsWith('/>') && !c.childNodes?.length) {
        el.selfClosing = true;
      }
      parent.append(el);
      convertP5(c.tagName === 'template' && c.content ? c.content : c, el, src);
    }
  }
}

function parse5Doc(p: Parse5Like, html: string): ParsedDoc {
  const d = p.parse(html, { scriptingEnabled: false, sourceCodeLocationInfo: true }) as P5Node;
  const root = new El('#root');
  convertP5(d, root, html);
  const htmlEl = root.elements().find((e) => e.name === 'html')!;
  // Document.body(): the body, else a frameset, else a new body.
  const body = htmlEl.elements().find((e) => e.name === 'body' || e.name === 'frameset') ?? (htmlEl.append(new El('body')) as El);
  // jsoup sends whitespace after </body> to <html>, not <body> (spec deviation).
  const p5body = d.childNodes?.find((n) => n.tagName === 'html')?.childNodes?.find((n) => n.tagName === body.name);
  const end = p5body?.sourceCodeLocation?.endTag;
  const last = body.children[body.children.length - 1];
  if (end && last?.kind === 'txt') {
    const post = html.slice(end.startOffset).replace(/<[^>]*>/g, '');
    if (/^[ \t\n\f\r]*$/.test(post) && post.length > 0 && last.value.endsWith(post)) {
      last.value = last.value.slice(0, last.value.length - post.length);
      if (last.value === '') detach(last);
    }
  }
  return { root, head: htmlEl.elements().find((e) => e.name === 'head')!, body };
}

function parse5Fragment(p: Parse5Like, html: string): El {
  const ctx = ((p.parse('', { scriptingEnabled: false }) as P5Node).childNodes![0]!).childNodes![1];
  const frag = p.parseFragment(ctx, html, { scriptingEnabled: false }) as P5Node;
  const body = new El('body');
  convertP5(frag, body);
  return body;
}

// ---------------------------------------------------------------- linkedom

function convertDom(n: globalThis.Node, parent: El): void {
  for (const c of [...n.childNodes]) {
    if (c.nodeType === 3) parent.append(new Txt(c.nodeValue ?? '', DATA.has(parent.name)));
    else if (c.nodeType === 8) {
      const v = c.nodeValue ?? '';
      if (/^\[CDATA\[[\s\S]*\]\]$/.test(v)) parent.append(new Txt(v.slice(7, -2), false, true));
      else parent.append(new Cmt(v));
    } else if (c.nodeType === 1) {
      const e = c as Element;
      const el = new El(e.localName.toLowerCase(), [...e.attributes].map((a) => [a.name.toLowerCase(), a.value] as [string, string]));
      parent.append(el);
      convertDom(e, el);
    }
  }
}

/**
 * The HTML5 rule linkedom lacks that Google-shaped exports hit: an end tag
 * </hN> closes whatever heading is open (<h3>..</h2> closes the h3).
 */
export function closeHeadings(html: string): string {
  const open: string[] = [];
  return html.replace(/<(\/?)h([1-6])(?=[\s>/])([^>]*)>/gi, (m, slash: string, level: string, rest: string) => {
    if (!slash) {
      open.push(level);
      return m;
    }
    const top = open.pop();
    return top && top !== level ? `</h${top}${rest}>` : m;
  });
}

function linkedomDoc(html: string): ParsedDoc {
  const d = linkedomDocument(closeHeadings(html));
  const root = new El('#root');
  const htmlEl = new El('html', [...d.documentElement.attributes].map((a) => [a.name.toLowerCase(), a.value] as [string, string]));
  root.append(htmlEl);
  const head = new El('head');
  const body = new El('body', [...d.body.attributes].map((a) => [a.name.toLowerCase(), a.value] as [string, string]));
  htmlEl.append(head);
  htmlEl.append(body);
  convertDom(d.head, head);
  convertDom(d.body, body);
  return { root, head, body };
}

function linkedomFrag(html: string): El {
  const d = linkedomFragment(closeHeadings(html));
  const body = new El('body');
  convertDom(d.body, body);
  return body;
}
