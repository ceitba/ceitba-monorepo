package org.ceitba.api.web.user.dto;

public record MeProfileResponse(
    String careerId,
    String plan,
    Integer fileNumber
) {}
