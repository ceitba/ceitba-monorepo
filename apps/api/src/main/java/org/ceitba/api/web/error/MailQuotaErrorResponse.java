package org.ceitba.api.web.error;

import java.time.Instant;
import java.time.OffsetDateTime;

// 429 MAIL_QUOTA_EXHAUSTED: ErrorResponse's fields plus `resumeAt`, when the
// sending account can send again (a superset, so generic error parsing keeps
// working).
public record MailQuotaErrorResponse(
    String error,
    String message,
    String path,
    Instant timestamp,
    OffsetDateTime resumeAt
) {}
