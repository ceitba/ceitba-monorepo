package org.ceitba.api.domain.news;

import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;

public class UserFollowId implements Serializable {

    private UUID userId;
    private String organization;

    public UserFollowId() {}

    public UserFollowId(UUID userId, String organization) {
        this.userId = userId;
        this.organization = organization;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof UserFollowId other)) return false;
        return Objects.equals(userId, other.userId)
            && Objects.equals(organization, other.organization);
    }

    @Override
    public int hashCode() {
        return Objects.hash(userId, organization);
    }
}
