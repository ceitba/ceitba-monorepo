package org.ceitba.api.web.staff.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import org.ceitba.api.domain.CeitbaBranch;
import org.ceitba.api.domain.CeitbaStaffRole;

import java.time.OffsetDateTime;

// Identifies the user by email rather than UUID — the caller (also a staff
// member) typically thinks in emails, and we'd have to look up the user
// anyway. Server resolves email -> User.id.
public record AssignStaffRequest(
    @NotBlank @Email String email,
    @NotNull CeitbaBranch branch,
    @NotNull CeitbaStaffRole role,
    @JsonProperty("start") @NotNull OffsetDateTime start,
    @JsonProperty("end") @NotNull OffsetDateTime end
) {}
