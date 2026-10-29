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
// Returns doc.outerHtml() pretty-printed like jsoup (./jsoup/pipeline.ts).

import { normalize, olType, parseCss } from './jsoup/pipeline';

export { olType, parseCss };

export function normalizeGoogleDocsHtml(html: string | null): string | null {
  return normalize(html);
}

/** For tests: the selectors parsed from a style sheet. */
export function cssSelectors(css: string): string[] {
  return [...parseCss(css).keys()];
}
