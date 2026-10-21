// service/news/ArticleLinkPreviewService + the HTML of web/news/ArticleLinkPreviewController:
// the Open Graph page link-preview crawlers get for a published article.

import { withTx } from '../../db/client';
import type { Deps } from '../../deps';
import { javaIsBlank, javaTrim } from '../../lib/javaCompat';
import { javaUriCreate } from '../../lib/javaUri';
import type { ArticleService } from './articles';
import * as repo from './repo';

export const MAX_DESCRIPTION = 200;
// Java's \s (ASCII whitespace) and [^\s)].
const MARKDOWN_IMAGE = /!\[[^\]]*\]\((https?:\/\/[^ \t\n\x0B\f\r)]+)/;
const MARKDOWN_SYNTAX = /!?\[([^\]]*)\]\([^)]*\)|[*_#>`]/g;
const JAVA_WS_RUN = /[ \t\n\x0B\f\r]+/g;

export interface LinkPreview {
  title: string;
  description: string;
  url: string;
  imageUrl: string | null;
  siteName: string;
  publishedAt: string | null;
}

/** HtmlUtils.htmlEscape(s, "UTF-8"): only the five characters with required references. */
export function htmlEscapeUtf8(s: string | null): string {
  if (s == null) return '';
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export class ArticleLinkPreviewService {
  private readonly newsletterUrl: string;
  private readonly origin: string;

  constructor(private readonly deps: Deps, private readonly articles: ArticleService) {
    this.newsletterUrl = deps.config.content.digest.publicBaseUrl;
    const base = javaUriCreate(this.newsletterUrl);
    this.origin = `${base.scheme}://${base.rawAuthority}`;
  }

  /** 404 (ResourceNotFound) unless the article is published. */
  preview(id: string): Promise<LinkPreview> {
    return withTx(this.deps.db, async (tx) => {
      const a = await this.articles.findById(id, false, tx);
      const org = a.organization === null ? null : await repo.findOrg(tx, a.organization);
      return {
        title: a.title,
        description: description(a),
        url: `${this.newsletterUrl}/articles/${a.id}`,
        imageUrl: this.image(a, org),
        siteName: org !== null && org.name != null ? `${org.name} · ITBA News` : 'ITBA News',
        publishedAt: a.publishedAt,
      };
    }, { readOnly: true });
  }

  private image(a: repo.ArticleRow, org: repo.OrgRow | null): string | null {
    if (a.coverImage != null && !javaIsBlank(a.coverImage)) return this.absolute(a.coverImage);
    for (const p of (a.body as (string | null)[] | null) ?? []) {
      const m = p == null ? null : MARKDOWN_IMAGE.exec(p);
      if (m) return m[1]!;
    }
    if (org !== null && org.logoUrl != null && !javaIsBlank(org.logoUrl)) return this.absolute(org.logoUrl);
    return null;
  }

  private absolute(url: string): string {
    return url.startsWith('/') && !url.startsWith('//') ? this.origin + url : url;
  }
}

/** The excerpt, else the first paragraph without its markdown. Keep in sync with articleDescription in apps/web/src/newsletter/utils/seo.ts. */
function description(a: repo.ArticleRow): string {
  let text = a.excerpt;
  if (text == null || javaIsBlank(text)) text = firstParagraph(a.body as (string | null)[] | null);
  text = javaTrim(text.replace(JAVA_WS_RUN, ' '));
  return text.length <= MAX_DESCRIPTION ? text : `${javaTrim(text.substring(0, MAX_DESCRIPTION - 1))}…`;
}

function firstParagraph(body: (string | null)[] | null): string {
  if (body == null) return '';
  for (const p of body) {
    const plain = p == null ? '' : javaTrim(p.replace(MARKDOWN_SYNTAX, (_m, g1?: string) => g1 ?? ''));
    if (plain !== '') return plain;
  }
  return '';
}

/** ArticleLinkPreviewController.html */
export function previewHtml(p: LinkPreview): string {
  const title = htmlEscapeUtf8(p.title);
  const description = htmlEscapeUtf8(p.description);
  const url = htmlEscapeUtf8(p.url);
  let sb = '<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n'
    + `<title>${title}</title>\n`
    + `<meta name="description" content="${description}">\n`
    + `<link rel="canonical" href="${url}">\n`
    + '<meta property="og:type" content="article">\n'
    + '<meta property="og:locale" content="es_AR">\n'
    + `<meta property="og:site_name" content="${htmlEscapeUtf8(p.siteName)}">\n`
    + `<meta property="og:title" content="${title}">\n`
    + `<meta property="og:description" content="${description}">\n`
    + `<meta property="og:url" content="${url}">\n`;
  if (p.imageUrl !== null) sb += `<meta property="og:image" content="${htmlEscapeUtf8(p.imageUrl)}">\n`;
  if (p.publishedAt !== null) sb += `<meta property="article:published_time" content="${p.publishedAt}">\n`;
  sb += `<meta name="twitter:card" content="${p.imageUrl !== null ? 'summary_large_image' : 'summary'}">\n`
    + '</head>\n<body>\n'
    + `<h1>${title}</h1>\n`
    + `<p>${description}</p>\n`
    + `<p><a href="${url}">Leer en ITBA News</a></p>\n`
    + '</body>\n</html>\n';
  return sb;
}

export const NOT_FOUND_HTML = '<!doctype html>\n<html lang="es"><head><meta charset="utf-8"><title>ITBA News</title></head>'
  + '<body><p>Artículo no encontrado.</p></body></html>\n';
