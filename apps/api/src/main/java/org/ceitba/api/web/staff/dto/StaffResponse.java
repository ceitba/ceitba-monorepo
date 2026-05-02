package org.ceitba.api.web.staff.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import org.ceitba.api.domain.CeitbaBranch;
import org.ceitba.api.domain.CeitbaStaffRole;

import java.time.OffsetDateTime;
import java.util.UUID;

public record StaffResponse(
    @JsonProperty("user_id") UUID userId,
    String email,
    String name,
    CeitbaBranch branch,
    CeitbaStaffRole role,
    OffsetDateTime start,
    OffsetDateTime end
) {}
