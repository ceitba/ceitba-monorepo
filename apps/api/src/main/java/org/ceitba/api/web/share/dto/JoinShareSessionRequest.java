package org.ceitba.api.web.share.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.UUID;

// Body for POST /v1/share/sessions/{token}/join. The participant attaches
// one of their own saved_schedules to the session.
public record JoinShareSessionRequest(
    @NotNull UUID savedScheduleId,
    @Size(max = 120) String displayName
) {}
