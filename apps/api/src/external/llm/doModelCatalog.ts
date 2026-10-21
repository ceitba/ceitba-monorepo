// Port of apps/api/src/main/java/org/ceitba/api/external/llm/HttpDoModelCatalog.java.
//
// Unauthenticated GET of DO's public model catalog, following links.pages.next
// (at most 10 pages), 20 s timeout per page.

import { LlmApiError } from '../../features/kb/logic/external/llmApi';
import { elements, isTextual, path, type JsonValue } from '../../features/kb/logic/jsonNode';
import type { DoModelCatalog } from '../llm';


export const CATALOG_URL = 'https://api.digitalocean.com/v2/gen-ai/models/catalog';

export class HttpDoModelCatalog implements DoModelCatalog {
  constructor(private readonly doFetch: typeof fetch = fetch, private readonly url = CATALOG_URL) {}

  async fetch(): Promise<Record<string, unknown>[]> {
    const out: JsonValue[] = [];
    let next: string | null = this.url + '?per_page=200';
    for (let page = 0; page < 10 && next != null; page++) {
      let body: JsonValue;
      try {
        const res = await this.doFetch(next, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
        if (Math.trunc(res.status / 100) !== 2) throw new LlmApiError(res.status, 'DO model catalog -> ' + res.status);
        body = JSON.parse(await res.text()) as JsonValue;
      } catch (e) {
        if (e instanceof LlmApiError) throw e;
        throw new LlmApiError(0, 'DO model catalog: ' + (e instanceof Error ? e.message : String(e)), e);
      }
      out.push(...elements(path(body, 'data')));
      const n = path(path(path(body, 'links'), 'pages'), 'next');
      next = isTextual(n) && n.trim() !== '' ? n : null;
    }
    return out as unknown as Record<string, unknown>[];
  }
}
