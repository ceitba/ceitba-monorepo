// service/crypto/ContentHmac as a bean: one instance per config, built from
// auth.jwt.secret and content.hmac-secret (CONTENT_HMAC_SECRET). The pure
// class is logic/contentHmac.ts.

import type { Config } from '../../config';
import { ContentHmac } from './logic/contentHmac';

const byConfig = new WeakMap<object, ContentHmac>();

/** The app's ContentHmac (derived keys cached inside it). */
export function contentHmac(config: Config): ContentHmac {
  let h = byConfig.get(config);
  if (!h) {
    h = new ContentHmac(config.auth.jwt.secret, config.auth.contentHmacSecret);
    byConfig.set(config, h);
  }
  return h;
}
