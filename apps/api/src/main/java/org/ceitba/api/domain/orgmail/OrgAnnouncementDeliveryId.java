package org.ceitba.api.domain.orgmail;

import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;

public class OrgAnnouncementDeliveryId implements Serializable {

    private Long announcementId;
    private UUID userId;

    public OrgAnnouncementDeliveryId() {}

    public OrgAnnouncementDeliveryId(Long announcementId, UUID userId) {
        this.announcementId = announcementId;
        this.userId = userId;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof OrgAnnouncementDeliveryId other)) return false;
        return Objects.equals(announcementId, other.announcementId) && Objects.equals(userId, other.userId);
    }

    @Override
    public int hashCode() {
        return Objects.hash(announcementId, userId);
    }
}
