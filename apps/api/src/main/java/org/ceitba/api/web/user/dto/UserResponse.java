package org.ceitba.api.web.user.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;
import java.util.UUID;

public record UserResponse(
    UUID id,
    String email,
    String name,
    @JsonProperty("file_number") Integer fileNumber,
    @JsonProperty("career_id") String careerId,
    String plan,
    String avatarUrl,
    boolean isStaff,
    List<Membership> organizations
) {
    public record Membership(String slug, String role) {}
}
