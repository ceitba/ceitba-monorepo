// Port of apps/api/src/main/java/org/ceitba/api/web/user/dto/RegisterDeviceRequest.java
// (PUT /v1/me/devices). `token` is the FCM registration token of this app
// install; `platform` is "ios" or "android" (case-insensitive). Messages are
// Hibernate's in the request locale (jv).

import type { z } from 'zod';
import { jv } from '../../../http/validation';

// FCM tokens are URL-safe base64 plus ':' separators; keeps them safe in DELETE /v1/me/devices/{token}.
export const TOKEN_PATTERN = '[A-Za-z0-9_:.\\-]+';
// Matches user_devices.token (V23). Real FCM tokens are ~150-250 chars.
export const MAX_TOKEN_LENGTH = 1024;

export const RegisterDeviceRequest = jv.object({
  token: jv.string({ notBlank: true, size: { max: MAX_TOKEN_LENGTH }, pattern: { regexp: TOKEN_PATTERN, js: /^[A-Za-z0-9_:.-]+$/ } }),
  platform: jv.string({ notBlank: true, pattern: { regexp: '(?i)ios|android', js: /^(?:ios|android)$/i } }),
  appVersion: jv.string({ size: { max: 32 } }),
});
export type RegisterDeviceRequest = NonNullable<z.output<typeof RegisterDeviceRequest>>;
