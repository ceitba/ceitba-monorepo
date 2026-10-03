package org.ceitba.api.domain.drive;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.OffsetDateTime;
import java.util.UUID;

// A Drive folder a student registered (V31), or a community archive / one
// of its subject folders (V42, kind). Transitions live in
// service/drive (DriveSourceService, DriveSyncStore, DriveModerationService).
@Entity
@Table(schema = "wiki", name = "drive_source")
public class DriveSource {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    // Null for community sources (kind != STUDENT).
    @Column(name = "user_id")
    private UUID userId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private DriveSourceKind kind = DriveSourceKind.STUDENT;

    // Author label of community sources ("Comunidad").
    @Column(name = "display_name", columnDefinition = "text")
    private String displayName;

    @Enumerated(EnumType.STRING)
    @Column(name = "storage_mode", nullable = false, length = 16)
    private DriveStorageMode storageMode = DriveStorageMode.COPY;

    // Community sources: the subject every file counts for (unless a file
    // has its own).
    @Column(name = "subject_id", length = 25)
    private String subjectId;

    @Column(name = "parent_source_id")
    private UUID parentSourceId;

    // Community: the archive's Drive owner (shortcut rule). Never exposed.
    @Column(name = "owner_email", length = 320)
    private String ownerEmail;

    @Column(name = "root_folder_id", nullable = false, length = 128)
    private String rootFolderId;

    @Column(name = "root_name", nullable = false, columnDefinition = "text")
    private String rootName;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private DriveSourceStatus status = DriveSourceStatus.PENDING_REVIEW;

    @Column(nullable = false)
    private boolean anonymous;

    @Column(name = "consent_version", nullable = false, length = 32)
    private String consentVersion;

    @Column(name = "consented_at", nullable = false)
    private OffsetDateTime consentedAt;

    @Column(name = "approved_at")
    private OffsetDateTime approvedAt;

    @Column(name = "reviewed_by")
    private UUID reviewedBy;

    @Column(name = "reviewed_at")
    private OffsetDateTime reviewedAt;

    @Column(name = "review_comment", columnDefinition = "text")
    private String reviewComment;

    @Column(name = "last_synced_at")
    private OffsetDateTime lastSyncedAt;

    @Column(name = "last_sync_requested_at")
    private OffsetDateTime lastSyncRequestedAt;

    @Column(name = "last_error", columnDefinition = "text")
    private String lastError;

    @Column(name = "consecutive_failures", nullable = false)
    private int consecutiveFailures;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    protected DriveSource() {}

    public DriveSource(UUID userId, String rootFolderId, String rootName, boolean anonymous,
                       String consentVersion, OffsetDateTime consentedAt) {
        this.userId = userId;
        this.rootFolderId = rootFolderId;
        this.rootName = rootName;
        this.anonymous = anonymous;
        this.consentVersion = consentVersion;
        this.consentedAt = consentedAt;
    }

    // A community folder (no owning user) under a COMMUNITY_ROOT archive.
    public static DriveSource community(DriveSource root, String folderId, String name, String subjectId,
                                        OffsetDateTime now) {
        var s = new DriveSource(null, folderId, name, false, "community", now);
        s.kind = DriveSourceKind.COMMUNITY;
        s.displayName = root.displayName;
        s.storageMode = root.storageMode;
        s.parentSourceId = root.id;
        s.ownerEmail = root.ownerEmail;
        s.subjectId = subjectId;
        s.status = DriveSourceStatus.ACTIVE;
        s.approvedAt = now;
        return s;
    }

    public boolean isCommunity() { return kind != DriveSourceKind.STUDENT; }

    // Approved sources (approved_at set) publish while ACTIVE or ERROR.
    public boolean isApproved() {
        return approvedAt != null && (status == DriveSourceStatus.ACTIVE || status == DriveSourceStatus.ERROR);
    }

    // Statuses whose files may be published at all.
    public boolean isLive() {
        return status == DriveSourceStatus.ACTIVE || status == DriveSourceStatus.PENDING_REVIEW
            || status == DriveSourceStatus.ERROR;
    }

    public UUID getId() { return id; }
    public UUID getUserId() { return userId; }
    public DriveSourceKind getKind() { return kind; }
    public String getDisplayName() { return displayName; }
    public DriveStorageMode getStorageMode() { return storageMode; }
    public String getSubjectId() { return subjectId; }
    public UUID getParentSourceId() { return parentSourceId; }
    public String getOwnerEmail() { return ownerEmail; }
    public void setSubjectId(String subjectId) { this.subjectId = subjectId; }
    public void setOwnerEmail(String ownerEmail) { this.ownerEmail = ownerEmail; }
    public void setDisplayName(String displayName) { this.displayName = displayName; }
    public void setStorageMode(DriveStorageMode storageMode) { this.storageMode = storageMode; }
    public String getRootFolderId() { return rootFolderId; }
    public String getRootName() { return rootName; }
    public DriveSourceStatus getStatus() { return status; }
    public boolean isAnonymous() { return anonymous; }
    public String getConsentVersion() { return consentVersion; }
    public OffsetDateTime getConsentedAt() { return consentedAt; }
    public OffsetDateTime getApprovedAt() { return approvedAt; }
    public UUID getReviewedBy() { return reviewedBy; }
    public OffsetDateTime getReviewedAt() { return reviewedAt; }
    public String getReviewComment() { return reviewComment; }
    public OffsetDateTime getLastSyncedAt() { return lastSyncedAt; }
    public OffsetDateTime getLastSyncRequestedAt() { return lastSyncRequestedAt; }
    public String getLastError() { return lastError; }
    public int getConsecutiveFailures() { return consecutiveFailures; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
    public OffsetDateTime getUpdatedAt() { return updatedAt; }

    public void setRootName(String rootName) { this.rootName = rootName; }
    public void setStatus(DriveSourceStatus status) { this.status = status; }
    public void setAnonymous(boolean anonymous) { this.anonymous = anonymous; }
    public void setConsent(String version, OffsetDateTime at) { this.consentVersion = version; this.consentedAt = at; }
    public void setApprovedAt(OffsetDateTime approvedAt) { this.approvedAt = approvedAt; }
    public void setReview(UUID by, OffsetDateTime at, String comment) {
        this.reviewedBy = by;
        this.reviewedAt = at;
        this.reviewComment = comment;
    }
    public void setLastSyncedAt(OffsetDateTime lastSyncedAt) { this.lastSyncedAt = lastSyncedAt; }
    public void setLastSyncRequestedAt(OffsetDateTime at) { this.lastSyncRequestedAt = at; }
    public void setLastError(String lastError) { this.lastError = lastError; }
    public void setConsecutiveFailures(int n) { this.consecutiveFailures = n; }
}
