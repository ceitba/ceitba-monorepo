package org.ceitba.api.web.user.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;

// JSON keys match the NestJS DTO (snake_case for file_number / career_id).
public record CreateUserRequest(
    @NotBlank @Email String email,
    String name,
    @JsonProperty("file_number") @Positive Integer fileNumber,
    @JsonProperty("career_id") String careerId,
    String plan
) {}
