// The slice of jsoup 1.21.2 that GoogleDocsHtml and DocHtmlSanitizer use
// (parse, parseBodyFragment, pretty/compact html(), text(), Safelist cleaning),
// ported for byte-identical output: the Doc content fingerprint hashes it.
export { Cmt, descendants, detach, El, replaceWith, Txt, type Node } from './dom';
export { parseBodyFragment, parseDoc, treeBuilder, useParse5, type Parse5Like } from './builders';
export { compact, escape, innerCompact, innerPretty, isBlock, javaTrim, text } from './print';
import { parseDoc } from './builders';
import { text } from './print';

/** Jsoup.parse(html).text() */
export function documentText(html: string): string {
  return text(parseDoc(html).root);
}
