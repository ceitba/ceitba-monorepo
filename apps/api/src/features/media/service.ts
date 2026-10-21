// service/media/MediaUploadService wired to the app's deps (storage, the
// per-user UserRateLimiter, ContentHmac from auth.jwt.secret / content.hmac-secret).
//
// Other features (proposal attachments, org images) use:
//   import { mediaUploads } from '../media/service';
//   mediaUploads(deps).signProposalAttachment(user.id, req)

import type { Deps } from '../../deps';
import { ContentHmac } from '../crypto/logic/contentHmac';
import { MediaUploadService } from './logic/mediaUploadService';

export { MediaUploadService, type SignUploadRequest, type SignUploadResponse } from './logic/mediaUploadService';

const cache = new WeakMap<object, MediaUploadService>();

/** The MediaUploadService singleton of these deps (built lazily: no work at route registration). */
export function mediaUploads(deps: Pick<Deps, 'storage' | 'userRateLimiter' | 'config'>): MediaUploadService {
  let svc = cache.get(deps);
  if (!svc) {
    const hmac = new ContentHmac(deps.config.auth.jwt.secret, deps.config.auth.contentHmacSecret);
    svc = new MediaUploadService(deps.storage, (rule, userId) => deps.userRateLimiter.consume(rule, userId), hmac);
    cache.set(deps, svc);
  }
  return svc;
}
