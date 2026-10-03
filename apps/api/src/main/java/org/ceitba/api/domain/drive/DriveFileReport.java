package org.ceitba.api.domain.drive;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;

import java.time.OffsetDateTime;
import java.util.UUID;

// One reader's report of a file; re-reporting replaces it.
@Entity
@IdClass(DriveFileReportId.class)
@Table(schema = "wiki", name = "drive_file_report")
public class DriveFileReport {

    @Id
    @Column(name = "file_id")
    private UUID fileId;

    @Id
    @Column(name = "user_id")
    private UUID userId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private DriveReportReason reason;

    @Column(columnDefinition = "text")
    private String comment;

    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;

    protected DriveFileReport() {}

    public DriveFileReport(UUID fileId, UUID userId, DriveReportReason reason, String comment,
                           OffsetDateTime createdAt) {
        this.fileId = fileId;
        this.userId = userId;
        this.reason = reason;
        this.comment = comment;
        this.createdAt = createdAt;
    }

    public UUID getFileId() { return fileId; }
    public UUID getUserId() { return userId; }
    public DriveReportReason getReason() { return reason; }
    public String getComment() { return comment; }
    public OffsetDateTime getCreatedAt() { return createdAt; }

    public void update(DriveReportReason reason, String comment, OffsetDateTime at) {
        this.reason = reason;
        this.comment = comment;
        this.createdAt = at;
    }
}
