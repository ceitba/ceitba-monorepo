// web/highlight/dto/*.

import type { z } from 'zod';
import { jv } from '../../http/validation';

const HTTP_URL = /^https?:\/\/[^ \t\n\x0B\f\r]+$/;
const LINK_URL = /^(?:[ \t\n\x0B\f\r]*|https?:\/\/[^ \t\n\x0B\f\r]+)$/;
const URL_MESSAGE = 'must be an http(s) URL';

/**
 * HighlightRequest: @NotBlank @Size(255) title; description; @NotBlank @Size(2048)
 * @Pattern("^https?://\\S+$", message = "must be an http(s) URL") imageUrl;
 * @Size(2048) @Pattern("^(\\s*|https?://\\S+)$", same message) linkUrl; int position;
 * OffsetDateTime startsAt/endsAt; Boolean active.
 */
export const HighlightRequest = jv.object({
  title: jv.string({ notBlank: true, size: { max: 255 } }),
  description: jv.string(),
  imageUrl: jv.string({ notBlank: true, size: { max: 2048 }, check: (v: string) => (HTTP_URL.test(v) ? null : URL_MESSAGE) }),
  linkUrl: jv.string({ size: { max: 2048 }, check: (v: string) => (LINK_URL.test(v) ? null : URL_MESSAGE) }),
  position: jv.int({ primitive: true }),
  startsAt: jv.instant(),
  endsAt: jv.instant(),
  active: jv.bool(),
});
export type HighlightRequest = NonNullable<z.output<typeof HighlightRequest>>;

/** HighlightResponse(id, title, description, imageUrl, linkUrl, position, startsAt, endsAt, active). */
export interface HighlightResponse {
  id: string;
  title: string;
  description: string | null;
  imageUrl: string;
  linkUrl: string | null;
  position: number;
  startsAt: string | null;
  endsAt: string | null;
  active: boolean;
}
