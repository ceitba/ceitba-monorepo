package org.ceitba.api.domain.kb;

import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;

// @IdClass of KbPageReport (pattern: domain/PlanSubject.java).
public class KbPageReportId implements Serializable {

    private UUID pageId;
    private UUID userId;

    public KbPageReportId() {}

    public KbPageReportId(UUID pageId, UUID userId) {
        this.pageId = pageId;
        this.userId = userId;
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof KbPageReportId other
            && Objects.equals(pageId, other.pageId) && Objects.equals(userId, other.userId);
    }

    @Override
    public int hashCode() {
        return Objects.hash(pageId, userId);
    }
}
