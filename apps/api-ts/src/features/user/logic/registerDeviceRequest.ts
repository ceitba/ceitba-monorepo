// Port of apps/api/src/main/java/org/ceitba/api/web/user/dto/RegisterDeviceRequest.java
// (PUT /v1/me/devices). `token` is the FCM registration token of this app
// install; `platform` is "ios" or "android" (case-insensitive).

import { z } from 'zod';
import { constraints, notBlank, pattern, size } from '../../../lib/beanConstraints';
import { jv } from '../../../http/validation';

// FCM tokens are URL-safe base64 plus ':' separators; keeps them safe in DELETE /v1/me/devices/{token}.
export const TOKEN_PATTERN = '[A-Za-z0-9_:.\\-]+';
// Matches user_devices.token (V23). Real FCM tokens are ~150-250 chars.
export const MAX_TOKEN_LENGTH = 1024;

export const RegisterDeviceRequest = jv.object({
  token: jv.string().superRefine(constraints(notBlank(), size({ max: MAX_TOKEN_LENGTH }),
    pattern(/^[A-Za-z0-9_:.-]+$/, TOKEN_PATTERN))),
  platform: jv.string().superRefine(constraints(notBlank(), pattern(/^(?:ios|android)$/i, '(?i)ios|android'))),
  appVersion: jv.string().superRefine(constraints(size({ max: 32 }))),
});
export type RegisterDeviceRequest = z.output<typeof RegisterDeviceRequest>;
