import { z } from 'zod';
import { parseDuration } from '../env';
import { defineSection } from '../registry';

// itba.api.*, sync.*, mobile-app.*, push.fcm.*, storage.* (application.yml).
// Normalization that the Java *Properties records apply (StorageProperties,
// MobileAppProperties, PushProperties...) is done by the feature that owns the
// value; this file only reads the env with the same names and defaults.
const schema = z.object({
  itba: z.object({
    baseUrl: z.string(),
    token: z.string(),
    /** ITBA_API_TIMEOUT, Java int millis. */
    timeoutMs: z.number().int(),
    useFake: z.boolean(),
    /** Local dev only, with useFake: plans nobody stubbed are replayed from plan_entry. */
    fakeFromDb: z.boolean(),
  }),
  sync: z.object({ enabled: z.boolean() }),
  mobileApp: z.object({ minVersion: z.string(), latestVersion: z.string(), maintenance: z.boolean() }),
  push: z.object({ serviceAccountJson: z.string(), serviceAccountPath: z.string() }),
  storage: z.object({
    endpoint: z.string(),
    region: z.string(),
    bucket: z.string(),
    accessKeyId: z.string(),
    secretAccessKey: z.string(),
    /** Trailing slashes removed (StorageProperties). */
    publicBaseUrl: z.string(),
    presignTtlMs: z.number().positive(),
    internalEndpoint: z.string(),
    /** Every connection field set (StorageProperties.configured()); otherwise sign endpoints answer 501. */
    configured: z.boolean(),
  }),
});

declare module '../registry' {
  interface ConfigSections { integrations: z.infer<typeof schema> }
}

export default defineSection('integrations', schema, ({ env }) => {
  const s = (a: string, b: string, d: string) => env.strChain([a, b], d);
  const storage = {
    endpoint: s('STORAGE_ENDPOINT', 'R2_ENDPOINT', ''),
    region: s('STORAGE_REGION', 'R2_REGION', 'us-east-1').trim() || 'us-east-1',
    bucket: s('STORAGE_BUCKET', 'R2_BUCKET', ''),
    accessKeyId: s('STORAGE_ACCESS_KEY_ID', 'R2_ACCESS_KEY_ID', ''),
    secretAccessKey: s('STORAGE_SECRET_ACCESS_KEY', 'R2_SECRET_ACCESS_KEY', ''),
    publicBaseUrl: s('STORAGE_PUBLIC_URL', 'R2_PUBLIC_URL', '').replace(/\/+$/, ''),
    presignTtlMs: (() => {
      const raw = s('STORAGE_PRESIGN_TTL', 'R2_PRESIGN_TTL', '10m');
      const v = raw.trim() === '' ? 0 : parseDuration(raw, 'STORAGE_PRESIGN_TTL');
      return v > 0 ? v : 10 * 60_000;
    })(),
    internalEndpoint: env.str('STORAGE_INTERNAL_ENDPOINT', ''),
    configured: false,
  };
  storage.configured = [storage.endpoint, storage.bucket, storage.accessKeyId, storage.secretAccessKey, storage.publicBaseUrl]
    .every((v) => v.trim() !== '');
  return {
    itba: {
      baseUrl: env.str('ITBA_API_BASE_URL', ''),
      token: env.str('ITBA_API_TOKEN', ''),
      timeoutMs: env.int('ITBA_API_TIMEOUT', 30000),
      useFake: env.bool('ITBA_API_USE_FAKE', false),
      fakeFromDb: env.bool('ITBA_API_FAKE_FROM_DB', false),
    },
    sync: { enabled: env.bool('SYNC_ENABLED', false) },
    mobileApp: {
      minVersion: env.str('MOBILE_MIN_VERSION', '0.0.0'),
      latestVersion: env.str('MOBILE_LATEST_VERSION', '0.0.0'),
      maintenance: env.bool('MOBILE_MAINTENANCE', false),
    },
    push: {
      serviceAccountJson: env.str('FIREBASE_SERVICE_ACCOUNT_JSON', ''),
      serviceAccountPath: env.str('FIREBASE_SERVICE_ACCOUNT_PATH', ''),
    },
    storage,
  };
});
