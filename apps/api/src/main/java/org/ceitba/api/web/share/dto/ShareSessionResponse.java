package org.ceitba.api.web.share.dto;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

// Public read model — no email/internal IDs leaked. The token is the only
// addressable identifier; creatorDisplayName is the legend label, not the
// underlying user. Used by both /v1/share/sessions/{token} (public) and
// the response of POST /v1/share/sessions (creator).
public record ShareSessionResponse(
    UUID id,
    String token,
    String name,
    String creatorDisplayName,
    OffsetDateTime expiresAt,
    OffsetDateTime createdAt,
    List<ParticipantResponse> participants
) {}
