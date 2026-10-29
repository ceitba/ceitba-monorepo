// web/media/dto/*.

import type { z } from 'zod';
import { jv } from '../../http/validation';

/** SignUploadRequest(@NotBlank filename, @NotBlank contentType, @Positive long sizeBytes). */
export const SignUploadRequest = jv.object({
  filename: jv.string({ notBlank: true }),
  contentType: jv.string({ notBlank: true }),
  sizeBytes: jv.long({ primitive: true, positive: true }),
});
export type SignUploadRequestBody = NonNullable<z.output<typeof SignUploadRequest>>;

/** The bound body as MediaUploadService takes it. */
export const toSignUpload = (b: SignUploadRequestBody) => ({ filename: b.filename!, contentType: b.contentType!, sizeBytes: b.sizeBytes! });
