package org.ceitba.api.domain.drive;

import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;

// @IdClass of DriveFileReport (pattern: domain/PlanSubject.java).
public class DriveFileReportId implements Serializable {

    private UUID fileId;
    private UUID userId;

    public DriveFileReportId() {}

    public DriveFileReportId(UUID fileId, UUID userId) {
        this.fileId = fileId;
        this.userId = userId;
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof DriveFileReportId other
            && Objects.equals(fileId, other.fileId) && Objects.equals(userId, other.userId);
    }

    @Override
    public int hashCode() {
        return Objects.hash(fileId, userId);
    }
}
