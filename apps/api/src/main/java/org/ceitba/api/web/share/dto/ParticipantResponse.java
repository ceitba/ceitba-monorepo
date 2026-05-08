package org.ceitba.api.web.share.dto;

import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;

// One participant in the public viewer payload. payload may be null if the
// user later deleted the saved_schedule that was attached to this session
// (FK was cleared via ON DELETE SET NULL); the SPA renders a placeholder
// row in that case. careerId+plan are included so the viewer can fetch the
// right subject catalog per participant when computing busy intervals.
public record ParticipantResponse(
    UUID userId,
    String displayName,
    boolean isCreator,
    String careerId,
    String plan,
    Map<String, Object> payload,
    OffsetDateTime joinedAt
) {}
