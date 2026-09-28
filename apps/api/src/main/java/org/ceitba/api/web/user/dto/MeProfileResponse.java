package org.ceitba.api.web.user.dto;

// Social fields are bare handles (no URL, no leading '@'); null when unset.
public record MeProfileResponse(
    String careerId,
    String plan,
    Integer fileNumber,
    String linkedin,
    String instagram,
    String discord
) {}
