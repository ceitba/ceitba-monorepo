package org.ceitba.api.web.auth.dto;

import java.util.List;
import java.util.UUID;

public record UserMeResponse(
    UUID   id,
    String name,
    String email,
    String role,
    // True for active STAFF (implied) and for an active MODERATOR grant.
    boolean moderator,
    String avatarUrl,
    String theme,
    String language,
    String careerId,
    String plan,
    Integer fileNumber,
    String linkedin,
    String instagram,
    String discord,
    List<MembershipDto> organizations,
    List<String> follows
) {
    public record MembershipDto(String slug, String role) {}
}
