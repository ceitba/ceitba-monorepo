// Replays the frozen jsoup 1.21.2 outputs (test/drive/fixtures/html/goldens/*.jsonl,
// produced by the real GoogleDocsHtml/DocHtmlSanitizer through
// fixtures/html/java/SpikeMain.java) through the TS port.
//   mode pipe:   sanitize(normalize(input)) -> html, text, used assets
//   mode san:    sanitize(input) -> html (and text/assets when recorded); "OK <html>" or "ERR" (Java threw)
//   mode unwrap: unwrapGoogleRedirect(input); "OK <href>" or "ERR"
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline, sanitize, unwrapGoogleRedirect } from '../../../src/features/drive/logic/jsoup/pipeline';

export const GOLDEN_DIR = join(import.meta.dir, '..', 'fixtures', 'html', 'goldens');
const ASSETS = new Map([['images/image1.png', 'image1.png'], ['images/image2.jpg', 'image2.jpg'], ['images/image 1.png', 'image_1.png']]);
const PREFIX = '/api/v1/wiki/files/__FILE__/assets/';
/** Parser-level differences parse5 vs jsoup on malformed tag soup (text in <tr>, &#0;, &#xD800;). */
export const KNOWN_PARSER_DIFFS = new Set(['g07-malformed']);

export interface GoldenResult { total: number; identical: number; known: number; failures: { file: string; name: string }[] }

export function runGoldens(): GoldenResult {
  const res: GoldenResult = { total: 0, identical: 0, known: 0, failures: [] };
  for (const f of readdirSync(GOLDEN_DIR).sort()) {
    for (const line of readFileSync(join(GOLDEN_DIR, f), 'utf8').split('\n').filter(Boolean)) {
      const g = JSON.parse(line) as { mode: string; name?: string; input: string; out?: string; html?: string; text?: string; assets?: string };
      res.total++;
      const tryR = (fn: () => string) => {
        try {
          return `OK ${fn()}`;
        } catch {
          return 'ERR';
        }
      };
      let same: boolean;
      try {
        if (g.mode === 'unwrap') same = tryR(() => unwrapGoogleRedirect(g.input)) === g.out;
        else if (g.out !== undefined) same = tryR(() => sanitize(g.input, ASSETS, PREFIX).html) === g.out;
        else {
          const r = (g.mode === 'pipe' ? pipeline : sanitize)(g.input, ASSETS, PREFIX);
          same = r.html === g.html && r.text === g.text && r.usedAssets.join(',') === g.assets;
        }
      } catch {
        same = false;
      }
      if (same) res.identical++;
      else if (g.name && KNOWN_PARSER_DIFFS.has(g.name)) res.known++;
      else res.failures.push({ file: f, name: g.name ?? JSON.stringify(g.input).slice(0, 80) });
    }
  }
  return res;
}
