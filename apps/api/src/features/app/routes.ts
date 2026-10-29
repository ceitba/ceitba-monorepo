// web/app/AppConfigController + config/MobileAppProperties normalization.
// Public (policy URL rule GET /v1/app/config).

import { defineRoutes, json } from '../../http/router';
import type { Config } from '../../config';
import { javaIsBlank, javaTrim } from '../../lib/javaCompat';

/** AppConfigResponse(minVersion, latestVersion, maintenance). */
export interface AppConfigResponse { minVersion: string; latestVersion: string; maintenance: boolean }

/** MobileAppProperties' compact constructor: blank min -> 0.0.0, blank latest -> min, values trimmed. */
export function mobileAppConfig(config: Config): AppConfigResponse {
  const raw = config.integrations.mobileApp;
  const minVersion = javaIsBlank(raw.minVersion) ? '0.0.0' : javaTrim(raw.minVersion);
  const latestVersion = javaIsBlank(raw.latestVersion) ? minVersion : javaTrim(raw.latestVersion);
  return { minVersion, latestVersion, maintenance: raw.maintenance === true };
}

export default defineRoutes((r, deps) => {
  const body = mobileAppConfig(deps.config);
  r.get('/v1/app/config', { tags: ['App'], summary: 'Mobile app release control: minimum and latest version, maintenance flag' },
    // CacheControl.maxAge(Duration.ofMinutes(1)).cachePublic()
    () => json(body, 200, { 'Cache-Control': 'max-age=60, public' }));
});
