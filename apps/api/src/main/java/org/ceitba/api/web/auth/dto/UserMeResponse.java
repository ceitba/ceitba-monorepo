package org.ceitba.api.web.auth.dto;

import java.util.UUID;

public record UserMeResponse(
    UUID   id,
    String name,
    String email,
    String role,
    String avatarUrl
) {}
