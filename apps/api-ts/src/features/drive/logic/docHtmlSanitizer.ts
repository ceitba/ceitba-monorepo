// Port of apps/api/src/main/java/org/ceitba/api/service/drive/DocHtmlSanitizer.java.
//
// Turns the HTML of a Google Doc export into something safe to inline in the
// SPA: jsoup's Safelist.relaxed (no style, class, script, iframe, event
// handlers) plus <s> and data-align (from GoogleDocsHtml; ol keeps
// start/type), images only from our asset endpoint, Google's link redirector
// unwrapped and links marked nofollow. Returns the body's inner HTML and its text.
// The cleaner is a port of jsoup's Cleaner + Safelist (src: jsoupDom.ts notes the
// parser/serializer differences).

import { JavaIllegalArgument, javaSplit, javaUrlDecode } from '../../../lib/javaCompat';
import { javaUriCreate, javaUriDecode, JavaUriSyntaxError } from '../../../lib/javaUri';
import { innerHtml, normalName, parseBodyFragment, parseDocument, setAttr, text } from './jsoupDom';

// Image sources are swapped for this absolute placeholder before cleaning (the
// safelist only admits http/https img sources) and for the asset path afterwards.
const PLACEHOLDER = 'https://drive-asset.invalid/';

export interface SanitizedDoc { html: string; text: string; usedAssets: string[] }

const ALIGN = ['data-align'];
// Safelist.relaxed() + addTags("s") + data-align.
const TAGS: Record<string, string[]> = {
  a: ['href', 'title'], b: [], blockquote: ['cite'], br: [], caption: [], cite: [], code: [], col: ['span', 'width'],
  colgroup: ['span', 'width'], dd: [], div: ALIGN, dl: [], dt: [], em: [], h1: ALIGN, h2: ALIGN, h3: ALIGN, h4: ALIGN,
  h5: ALIGN, h6: ALIGN, i: [], img: ['align', 'alt', 'height', 'src', 'title', 'width'], li: ALIGN, ol: ['start', 'type'],
  p: ALIGN, pre: [], q: ['cite'], small: [], span: [], strike: [], strong: [], sub: [], sup: [],
  table: ['summary', 'width'], tbody: [], td: ['abbr', 'axis', 'colspan', 'rowspan', 'width', 'data-align'], tfoot: [],
  th: ['abbr', 'axis', 'colspan', 'rowspan', 'scope', 'width', 'data-align'], thead: [], tr: [], u: [], ul: ['type'], s: [],
};
const PROTOCOLS: Record<string, string[]> = {
  'a href': ['ftp', 'http', 'https', 'mailto'], 'blockquote cite': ['http', 'https'], 'cite cite': ['http', 'https'],
  'img src': ['http', 'https'], 'q cite': ['http', 'https'],
};
const ENFORCED: Record<string, [string, string][]> = { a: [['rel', 'nofollow noopener noreferrer'], ['target', '_blank']] };

/**
 * Element.absUrl(attr) with base URI "": java.net.URL of the value itself
 * (scheme lower-cased by toExternalForm), "" when it is relative or not a URL.
 */
function absUrl(value: string): string {
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(value);
  if (!m) return '';
  const scheme = m[1]!.toLowerCase();
  // java.net.URL knows http, https, ftp, file, jar, mailto; other schemes fall back to the raw value.
  if (['http', 'https', 'ftp', 'file', 'jar', 'mailto'].includes(scheme)) return scheme + value.slice(m[1]!.length);
  return value;
}

/** Safelist.testValidProtocol: sets the attribute to its absolute form, then checks the scheme. */
function validProtocol(value: string, protocols: string[]): { ok: boolean; value: string } {
  let v = absUrl(value);
  if (v.length === 0) v = value;
  const lower = v.toLowerCase();
  return { ok: protocols.some((p) => lower.startsWith(`${p}:`)), value: v };
}

/** Jsoup.clean(bodyHtml, "", safelist): the cleaned body's inner HTML. */
export function cleanRelaxed(bodyHtml: string): string {
  const dirty = parseBodyFragment(bodyHtml);
  const clean = parseBodyFragment('');
  const copy = (source: Node, dest: Element) => {
    for (const child of [...source.childNodes]) {
      if (child.nodeType === 1) {
        const el = child as Element;
        const tag = normalName(el);
        const allowed = TAGS[tag];
        if (allowed) {
          const out = clean.createElement(tag);
          for (const a of [...el.attributes]) {
            const key = a.name.toLowerCase();
            if (!allowed.includes(key)) continue;
            const protocols = PROTOCOLS[`${tag} ${key}`];
            if (protocols) {
              const r = validProtocol(a.value, protocols);
              if (r.ok) setAttr(out, key, r.value);
            } else {
              setAttr(out, key, a.value);
            }
          }
          for (const [k, v] of ENFORCED[tag] ?? []) setAttr(out, k, v);
          dest.appendChild(out);
          copy(el, out);
        } else {
          // Unsafe element: dropped, its children are kept (data of script/style is not text, so it goes).
          if (tag !== 'script' && tag !== 'style') copy(el, dest);
        }
      } else if (child.nodeType === 3) {
        dest.appendChild(clean.createTextNode(child.nodeValue ?? ''));
      }
    }
  };
  copy(dirty.body, clean.body);
  return innerHtml(clean.body);
}

/**
 * srcToAsset: image src as written in the export (e.g. "images/image1.png") ->
 * stored asset name. assetUrlPrefix: e.g. "/api/v1/wiki/files/<id>/assets/".
 */
export function sanitizeDocHtml(rawHtml: string | null, srcToAsset: ReadonlyMap<string, string>, assetUrlPrefix: string): SanitizedDoc {
  const doc = parseDocument(rawHtml ?? '');
  for (const img of [...doc.body.querySelectorAll('img')]) {
    const src = img.getAttribute('src') ?? '';
    // URLDecoder.decode throws on a bad escape (uncaught in Java too).
    const asset = srcToAsset.get(src) ?? srcToAsset.get(javaUrlDecode(src));
    if (asset == null) img.remove();
    else img.setAttribute('src', PLACEHOLDER + asset);
  }
  for (const a of [...doc.body.querySelectorAll('a[href]')]) {
    a.setAttribute('href', unwrapGoogleRedirect(a.getAttribute('href')!));
  }
  const cleaned = cleanRelaxed(innerHtml(doc.body));

  const out = parseBodyFragment(cleaned);
  const known = new Set(srcToAsset.values());
  const used: string[] = [];
  for (const img of [...out.body.querySelectorAll('img')]) {
    const src = img.getAttribute('src') ?? '';
    if (!src.startsWith(PLACEHOLDER)) {
      img.remove();
      continue;
    }
    const name = src.slice(PLACEHOLDER.length);
    if (!known.has(name)) {
      img.remove();
      continue;
    }
    img.setAttribute('src', assetUrlPrefix + name);
    if (!used.includes(name)) used.push(name);
  }
  return { html: innerHtml(out.body), text: text(out.body), usedAssets: used };
}

/** https://www.google.com/url?q=<target>&sa=... -> <target> */
export function unwrapGoogleRedirect(href: string): string {
  try {
    const uri = javaUriCreate(href);
    if (uri.host != null && uri.host.endsWith('google.com') && javaUriDecode(uri.rawPath) === '/url' && uri.rawQuery != null) {
      for (const pair of javaSplit(uri.rawQuery, /&/)) {
        if (pair.startsWith('q=')) return javaUrlDecode(pair.slice(2));
      }
    }
  } catch (e) {
    // keep as is; the safelist drops unsupported protocols anyway (IllegalArgumentException,
    // which URLDecoder's bad-escape error also is).
    if (!(e instanceof JavaUriSyntaxError) && !(e instanceof JavaIllegalArgument)) throw e;
  }
  return href;
}
