package org.ceitba.api.web.drive.dto;

import java.time.OffsetDateTime;

public record UnclaimedShareResponse(String name, String ownerEmail, OffsetDateTime firstSeenAt,
                                     OffsetDateTime lastSeenAt) {}
