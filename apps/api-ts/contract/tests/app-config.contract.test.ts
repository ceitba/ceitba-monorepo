// Ports apps/api/src/test/java/org/ceitba/api/web/app/AppConfigIT.java
// (@TestPropertySource mobile-app.* -> MOBILE_* env).
import { describe, expect, test } from 'bun:test';
import { useServer } from '../support';

const api = useServer({ env: { MOBILE_MIN_VERSION: '1.2.0', MOBILE_LATEST_VERSION: '1.4.1', MOBILE_MAINTENANCE: 'true' } });
const blank = useServer({ env: { MOBILE_MIN_VERSION: ' 2.0.0 ', MOBILE_LATEST_VERSION: '' } });

describe('AppConfigIT', () => {
  test('appConfigIsPublicAndPropertiesBacked', async () => {
    const r = await api.get('/v1/app/config');
    expect(r.status).toBe(200);
    expect(r.headers.get('Cache-Control')).toBe('max-age=60, public');
    expect(r.text).toBe('{"minVersion":"1.2.0","latestVersion":"1.4.1","maintenance":true}');
  });

  // Not in the IT: MobileAppProperties normalization (trim, blank latest -> min).
  test('blankLatestVersionFallsBackToTrimmedMinVersion', async () => {
    const r = await blank.get('/v1/app/config');
    expect(r.status).toBe(200);
    expect(r.text).toBe('{"minVersion":"2.0.0","latestVersion":"2.0.0","maintenance":false}');
  });
});
