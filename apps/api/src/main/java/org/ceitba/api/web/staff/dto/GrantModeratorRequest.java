package org.ceitba.api.web.staff.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;

// Identifies the user by email, like AssignStaffRequest. The user must have
// signed in at least once (User rows are JIT-provisioned).
public record GrantModeratorRequest(@NotBlank @Email String email) {}
