// Partial port of apps/api/src/main/java/org/ceitba/api/service/kb/admin/KbEndpointService.java:
// endpoint discovery (discover/discoverInto) and the pure validators (NAME, baseUrl).
//
// Staff-managed custom OpenAI-compatible endpoints (own GPU server). The API
// key is encrypted at rest (KbSecretCipher) and never returned or logged.
// The CRUD/test/stats endpoints, the KbEndpointDtos.Item view and the transaction
// boundaries are kb-admin/endpoints.ts, which wraps this class.

import { ExternalApiError, ResourceNotFoundError, ValidationError } from '../../../../http/errors';
import { Dec } from '../decimal';
import { LlmApiError } from '../external/llmApi';
import { jIsBlank, jTrim } from '../javaString';
import type { Now } from '../odt';
import type { KbLlmEndpointStore, KbModelStore, Tx } from '../ports';
import { KbModel, type KbLlmEndpoint } from '../types';
import { catalogId, type KbEndpointRegistry } from '../llm/kbEndpointRegistry';
import type { KbSecretCipher } from '../llm/kbSecretCipher';

/** Endpoint names: lowercase letters, digits and '-' (max 47 chars), whole-string match. */
export const NAME = /^[a-z0-9][a-z0-9-]{0,46}$/;

export interface DiscoverResult {
  added: string[];
  existing: string[];
}

/** http(s) only, with a host; no user info, query or fragment; trailing slashes dropped. */
export function baseUrl(raw: string | null): string {
  let s = raw == null ? '' : jTrim(raw);
  let ok: boolean;
  try {
    // java.net.URI is stricter than WHATWG URL about some characters; scheme/host/userinfo/query/fragment match.
    const u = new URL(s);
    const scheme = u.protocol.replace(/:$/, '').toLowerCase();
    ok = (scheme === 'http' || scheme === 'https') && u.hostname !== '' && u.username === '' && u.password === ''
      && !s.includes('?') && !s.includes('#');
  } catch {
    ok = false;
  }
  if (!ok) throw new ValidationError('baseUrl', s, 'must be an http(s) URL with a host (e.g. http://host:8081/v1)');
  s = s.replace(/\/+$/, '');
  if (s.length > 512) throw new ValidationError('baseUrl', s, 'too long');
  return s;
}

export class KbEndpointService {
  constructor(
    private readonly endpoints: KbLlmEndpointStore,
    private readonly models: KbModelStore,
    private readonly cipher: KbSecretCipher,
    private readonly registry: KbEndpointRegistry,
    private readonly now: Now,
    private readonly tx: Tx,
    private readonly info: (msg: string) => void = () => {},
  ) {}

  /**
   * Lists the endpoint's models and adds custom:<name>:<slug> to the catalog
   * (provider custom, no batch, price 0, disabled); existing ones are untouched.
   */
  async discover(id: string): Promise<DiscoverResult> {
    const e = await this.tx(() => this.get(id));
    if (e.hasKey() && !this.cipher.readable(e.apiKeyEncrypted)) {
      throw new ValidationError('apiKey', '(hidden)', 'the stored token cannot be decrypted: re-enter the token');
    }
    let ids: string[];
    try {
      ids = await this.registry.client(e).listModels();
    } catch (ex) {
      if (ex instanceof LlmApiError) {
        throw new ExternalApiError(`custom endpoint '${e.name}'`, `discover models (${ex.message})`, ex);
      }
      throw ex;
    }
    return this.tx(() => this.discoverInto(e, ids));
  }

  private async discoverInto(e: KbLlmEndpoint, ids: (string | null)[]): Promise<DiscoverResult> {
    const added: string[] = [];
    const existing: string[] = [];
    const now = this.now();
    for (const raw of ids) {
      if (raw == null || jIsBlank(raw) || raw.length > 512) continue;
      // Slash-free id; the same raw id always maps to the same catalog id.
      let id = catalogId(e.name, raw, false);
      let found = await this.models.findById(id);
      if (found != null && found.remoteModelId != null && found.remoteModelId !== raw) {
        // Another raw id slugs to the same id: tell them apart with a hash.
        id = catalogId(e.name, raw, true);
        found = await this.models.findById(id);
      }
      if (found != null) {
        if (found.remoteModelId == null) {
          found.remoteModelId = raw;
          await this.models.save(found); // no unit of work (ports.ts)
        }
        existing.push(id);
        continue;
      }
      const m = new KbModel(id, raw, 'custom', false, false);
      m.remoteModelId = raw;
      m.setPrices(Dec.ZERO, Dec.ZERO, null, null, now);
      m.priceSource = 'custom';
      await this.models.save(m);
      added.push(id);
    }
    this.info(`KB endpoint ${e.name}: discovered ${added.length} new model(s), ${existing.length} known`);
    return { added, existing };
  }

  private async get(id: string): Promise<KbLlmEndpoint> {
    const e = await this.endpoints.findById(id);
    if (e == null) throw new ResourceNotFoundError('KbLlmEndpoint', id);
    return e;
  }
}
