package org.ceitba.api.web.user.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Positive;

// PATCH /v1/users/{id}/file-number (STAFF). snake_case like CreateUserRequest.
// null clears the file number, so the user can enter it again themselves.
public record UpdateFileNumberRequest(
    @JsonProperty("file_number") @Positive @Max(999_999) Integer fileNumber
) {}
