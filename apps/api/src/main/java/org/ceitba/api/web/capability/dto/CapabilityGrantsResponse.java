package org.ceitba.api.web.capability.dto;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

// userId/name are filled when a user with that email exists.
public record CapabilityGrantsResponse(List<UserGrant> users, List<OrgGrant> orgs) {

    public record UserGrant(String email, UUID userId, String name,
                            OffsetDateTime grantedAt, String grantedByName) {}

    public record OrgGrant(String slug, String name, long memberCount,
                           OffsetDateTime grantedAt, String grantedByName) {}
}
