package org.ceitba.api.domain.digest;

import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;

public class DigestDeliveryId implements Serializable {

    private UUID issueId;
    private UUID userId;

    public DigestDeliveryId() {}

    public DigestDeliveryId(UUID issueId, UUID userId) {
        this.issueId = issueId;
        this.userId = userId;
    }

    public UUID getIssueId() { return issueId; }
    public UUID getUserId() { return userId; }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof DigestDeliveryId that)) return false;
        return Objects.equals(issueId, that.issueId) && Objects.equals(userId, that.userId);
    }

    @Override
    public int hashCode() {
        return Objects.hash(issueId, userId);
    }
}
