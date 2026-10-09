package org.ceitba.api.domain.orgmail;

import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;

public class OrgMailOptoutId implements Serializable {

    private UUID userId;
    private String orgSlug;

    public OrgMailOptoutId() {}

    public OrgMailOptoutId(UUID userId, String orgSlug) {
        this.userId = userId;
        this.orgSlug = orgSlug;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof OrgMailOptoutId other)) return false;
        return Objects.equals(userId, other.userId) && Objects.equals(orgSlug, other.orgSlug);
    }

    @Override
    public int hashCode() {
        return Objects.hash(userId, orgSlug);
    }
}
