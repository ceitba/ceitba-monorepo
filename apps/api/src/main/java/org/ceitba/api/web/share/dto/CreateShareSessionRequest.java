package org.ceitba.api.web.share.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.UUID;

// Body for POST /v1/share/sessions. The creator picks one of their
// saved_schedules to anchor the session; their displayName goes into
// the heatmap legend. Session name is optional (e.g. "TPE study group").
public record CreateShareSessionRequest(
    @NotNull UUID savedScheduleId,
    @Size(max = 120) String displayName,
    @Size(max = 120) String name
) {}
