// web/media/MediaController: presigned PUTs for STAFF CMS images (501 when
// object storage is not configured). STAFF via METHOD_RULES.

import { defineRoutes } from '../../http/router';
import { SignUploadRequest, toSignUpload } from './dto';
import { mediaUploads } from './service';

export default defineRoutes((r, deps) => {
  r.post('/v1/media/sign-upload', { tags: ['Media'], summary: 'Sign a PUT upload of a CMS image (STAFF)', body: SignUploadRequest },
    ({ body }) => mediaUploads(deps).signStaffImage(toSignUpload(body)));
});
