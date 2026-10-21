// Port of apps/api/src/main/java/org/ceitba/api/service/kb/admin/KbCatalogItem.java.
//
// One item of DO's public model catalog, normalized. Prices: the catalog's
// *_price_per_million fields hold per-TOKEN prices (glm-5.3 input 1.4e-06);
// a value below 0.01 is taken as per token and multiplied by 1e6, otherwise
// as already per million (perTokenFields says which fields were converted).
// Numbers keep BigDecimal.valueOf(double) digits (Jackson DoubleNode.decimalValue()).

import { Dec, dec, NumberFormatError } from '../decimal';
import { equalsIgnoreCase, jTrim, lowerRoot } from '../javaString';
import { asInt, asText, canConvertToInt, decimalValue, elements, has, isArray, isMissing, isNull, isNumber, isTextual, nodeToString, path, type Node } from '../jsonNode';

const CHAT_TYPES = new Set(['chat', 'reasoning', 'coding']);
const ONE_CENT = dec('0.01');
const MILLION = Dec.fromInt(1_000_000);

export class KbCatalogItem {
  constructor(
    readonly id: string | null,
    readonly name: string | null,
    readonly creator: string | null,
    readonly contextWindow: number | null,
    readonly maxOutputTokens: number | null,
    readonly capabilities: string[],
    readonly availability: string[],
    readonly type: string | null,
    readonly inputPerM: Dec | null,
    readonly outputPerM: Dec | null,
    readonly cacheReadPerM: Dec | null,
    readonly perTokenFields: string[],
  ) {}

  static of(n: Node): KbCatalogItem {
    const pricing = path(n, 'pricing');
    const converted: string[] = [];
    const input = perMillion(path(pricing, 'input_price_per_million'), 'input', converted);
    const output = perMillion(path(pricing, 'output_price_per_million'), 'output', converted);
    const cacheNode = has(pricing, 'cache_read_input_price_per_million')
      ? path(pricing, 'cache_read_input_price_per_million')
      : path(pricing, 'input_cache_read');
    const cache = perMillion(cacheNode, 'cacheRead', converted);
    const creator = path(n, 'creator');
    const creatorName = isTextual(creator) ? creator : asText(path(creator, 'name'), asText(path(creator, 'id'), null));
    return new KbCatalogItem(
      asText(path(n, 'model_id'), asText(path(n, 'id'), null)),
      cut(asText(path(n, 'name'), null), 128),
      cut(creatorName, 32),
      integer(path(n, 'context_window')),
      integer(path(n, 'max_output_tokens')),
      strings(path(n, 'capabilities')),
      strings(path(n, 'availability')),
      asText(path(n, 'type'), null),
      input,
      output,
      cache,
      converted,
    );
  }

  has(capability: string): boolean {
    return this.capabilities.some((c) => equalsIgnoreCase(c, capability));
  }

  /** Chat models served serverless (when the catalog says so). */
  serverlessChat(): boolean {
    const chat = this.type == null || CHAT_TYPES.has(lowerRoot(this.type));
    const serverless = this.availability.length === 0 || this.availability.some((a) => equalsIgnoreCase(a, 'serverless'));
    return chat && serverless;
  }
}

export function perMillion(v: Node, field: string, converted: string[]): Dec | null {
  if (v == null || isMissing(v) || isNull(v)) return null;
  let d: Dec;
  try {
    d = isNumber(v) ? decimalValue(v) : dec(jTrim(asText(v)));
  } catch (e) {
    if (e instanceof NumberFormatError) return null;
    throw e;
  }
  if (d.signum() < 0) return null;
  if (d.signum() > 0 && d.compareTo(ONE_CENT) < 0) {
    converted.push(field);
    d = d.multiply(MILLION);
  }
  return d.setScale(4, 'HALF_UP');
}

/** Fits the kb_model columns (display_name 128, provider 32). */
export function cut(v: string | null, max: number): string | null {
  return v == null || v.length <= max ? v : v.substring(0, max);
}

export function integer(v: Node): number | null {
  if (v == null || isMissing(v) || isNull(v)) return null;
  if (canConvertToInt(v)) return asInt(v);
  const t = jTrim(asText(v)).replaceAll(',', '');
  return /^[+-]?\d+$/.test(t) && Math.abs(Number(t)) <= 2147483647 ? Number(t) : null;
}

export function strings(arr: Node): string[] {
  const out: string[] = [];
  if (arr != null && isArray(arr)) {
    for (const x of elements(arr)) out.push(lowerRoot(isTextual(x) ? x : asText(path(x, 'name'), nodeToString(x))!));
  }
  return out;
}
