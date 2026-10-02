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
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

// One Drive item (folder or file) under a source's root (V31). Identity is
// (source_id, drive_id); the id survives renames, moves and moves to another
// source of the same student. The sync
// writes the Drive metadata and the stored copy; the student writes
// subject/hidden; PublicationRule derives `publication`.
@Entity
@Table(schema = "wiki", name = "drive_file")
public class DriveFile {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "source_id", nullable = false)
    private UUID sourceId;

    @Column(name = "drive_id", nullable = false, length = 128)
    private String driveId;

    @Column(name = "parent_drive_id", length = 128)
    private String parentDriveId;

    @Column(nullable = false, columnDefinition = "text")
    private String name;

    @Column(name = "mime_type", nullable = false, length = 255)
    private String mimeType;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private DriveFileKind kind;

    @Column(name = "owner_email", length = 320)
    private String ownerEmail;

    @Column(name = "owned_by_sharer", nullable = false)
    private boolean ownedBySharer;

    @Column(name = "drive_version")
    private Long driveVersion;

    @Column(name = "md5_checksum", length = 64)
    private String md5Checksum;

    @Column(name = "size_bytes")
    private Long sizeBytes;

    @Column(name = "drive_modified_at")
    private OffsetDateTime driveModifiedAt;

    @Column(name = "subject_id", length = 25)
    private String subjectId;

    @Column(name = "effective_subject_id", length = 25)
    private String effectiveSubjectId;

    @Column(name = "suggested_subject_id", length = 25)
    private String suggestedSubjectId;

    @Column(nullable = false)
    private boolean hidden;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private DrivePublication publication = DrivePublication.PRIVATE;

    @Enumerated(EnumType.STRING)
    @Column(name = "staff_decision", length = 8)
    private DriveStaffDecision staffDecision;

    @Column(name = "published_at")
    private OffsetDateTime publishedAt;

    @Column(name = "report_count", nullable = false)
    private int reportCount;

    @Column(name = "content_version")
    private Long contentVersion;

    @Column(name = "content_fingerprint", length = 64)
    private String contentFingerprint;

    @Column(name = "content_modified_at")
    private OffsetDateTime contentModifiedAt;

    @Column(name = "html_content", columnDefinition = "text")
    private String htmlContent;

    @Column(name = "pdf_key", columnDefinition = "text")
    private String pdfKey;

    @Column(name = "original_key", columnDefinition = "text")
    private String originalKey;

    @Column(name = "original_content_type", length = 255)
    private String originalContentType;

    @Column(name = "asset_prefix", columnDefinition = "text")
    private String assetPrefix;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "asset_names", columnDefinition = "jsonb", nullable = false)
    private List<String> assetNames = new ArrayList<>();

    @Column(name = "text_content", columnDefinition = "text")
    private String textContent;

    @Column(name = "metadata_only", nullable = false)
    private boolean metadataOnly;

    @Column(name = "sync_error", columnDefinition = "text")
    private String syncError;

    @Column(name = "removed_at")
    private OffsetDateTime removedAt;

    @Column(name = "purge_after")
    private OffsetDateTime purgeAfter;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    protected DriveFile() {}

    public DriveFile(UUID sourceId, String driveId) {
        this.sourceId = sourceId;
        this.driveId = driveId;
    }

    // Every storage key this row references (for deletion).
    public List<String> storageKeys() {
        var keys = new ArrayList<String>();
        if (pdfKey != null) keys.add(pdfKey);
        if (originalKey != null && !originalKey.equals(pdfKey)) keys.add(originalKey);
        if (assetPrefix != null && assetNames != null) {
            for (var n : assetNames) keys.add(assetPrefix + n);
        }
        return keys;
    }

    public boolean isFolder() { return kind == DriveFileKind.FOLDER; }
    public boolean isRemovedFromDrive() { return removedAt != null; }

    public UUID getId() { return id; }
    public UUID getSourceId() { return sourceId; }
    public String getDriveId() { return driveId; }
    public String getParentDriveId() { return parentDriveId; }
    public String getName() { return name; }
    public String getMimeType() { return mimeType; }
    public DriveFileKind getKind() { return kind; }
    public String getOwnerEmail() { return ownerEmail; }
    public boolean isOwnedBySharer() { return ownedBySharer; }
    public Long getDriveVersion() { return driveVersion; }
    public String getMd5Checksum() { return md5Checksum; }
    public Long getSizeBytes() { return sizeBytes; }
    public OffsetDateTime getDriveModifiedAt() { return driveModifiedAt; }
    public String getSubjectId() { return subjectId; }
    public String getEffectiveSubjectId() { return effectiveSubjectId; }
    public String getSuggestedSubjectId() { return suggestedSubjectId; }
    public boolean isHidden() { return hidden; }
    public DrivePublication getPublication() { return publication; }
    public DriveStaffDecision getStaffDecision() { return staffDecision; }
    public OffsetDateTime getPublishedAt() { return publishedAt; }
    public int getReportCount() { return reportCount; }
    public Long getContentVersion() { return contentVersion; }
    public String getContentFingerprint() { return contentFingerprint; }
    public OffsetDateTime getContentModifiedAt() { return contentModifiedAt; }
    public String getHtmlContent() { return htmlContent; }
    public String getPdfKey() { return pdfKey; }
    public String getOriginalKey() { return originalKey; }
    public String getOriginalContentType() { return originalContentType; }
    public String getAssetPrefix() { return assetPrefix; }
    public List<String> getAssetNames() { return assetNames == null ? List.of() : List.copyOf(assetNames); }
    public String getTextContent() { return textContent; }
    public boolean isMetadataOnly() { return metadataOnly; }
    public String getSyncError() { return syncError; }
    public OffsetDateTime getRemovedAt() { return removedAt; }
    public OffsetDateTime getPurgeAfter() { return purgeAfter; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
    public OffsetDateTime getUpdatedAt() { return updatedAt; }

    public void setMetadata(String parentDriveId, String name, String mimeType, DriveFileKind kind,
                            String ownerEmail, boolean ownedBySharer, Long driveVersion, String md5Checksum,
                            Long sizeBytes, OffsetDateTime driveModifiedAt) {
        this.parentDriveId = parentDriveId;
        this.name = name;
        this.mimeType = mimeType;
        this.kind = kind;
        this.ownerEmail = ownerEmail;
        this.ownedBySharer = ownedBySharer;
        this.driveVersion = driveVersion;
        this.md5Checksum = md5Checksum;
        this.sizeBytes = sizeBytes;
        this.driveModifiedAt = driveModifiedAt;
    }

    public void setContent(Long version, String fingerprint, String htmlContent, String pdfKey, String originalKey,
                           String originalContentType, String assetPrefix, List<String> assetNames,
                           String textContent, boolean metadataOnly) {
        this.contentVersion = version;
        this.contentFingerprint = fingerprint;
        this.htmlContent = htmlContent;
        this.pdfKey = pdfKey;
        this.originalKey = originalKey;
        this.originalContentType = originalContentType;
        this.assetPrefix = assetPrefix;
        this.assetNames = assetNames == null ? new ArrayList<>() : new ArrayList<>(assetNames);
        this.textContent = textContent;
        this.metadataOnly = metadataOnly;
    }

    // Moves the row to another source of the same student (cross-source move).
    public void moveTo(UUID sourceId) { this.sourceId = sourceId; }
    public boolean hasContent() { return contentFingerprint != null; }
    public void setContentModifiedAt(OffsetDateTime at) { this.contentModifiedAt = at; }
    public void setContentVersion(Long version) { this.contentVersion = version; }
    public void setSubjectId(String subjectId) { this.subjectId = subjectId; }
    public void setEffectiveSubjectId(String id) { this.effectiveSubjectId = id; }
    public void setSuggestedSubjectId(String id) { this.suggestedSubjectId = id; }
    public void setHidden(boolean hidden) { this.hidden = hidden; }
    public void setPublication(DrivePublication publication) { this.publication = publication; }
    public void setStaffDecision(DriveStaffDecision staffDecision) { this.staffDecision = staffDecision; }
    public void setPublishedAt(OffsetDateTime publishedAt) { this.publishedAt = publishedAt; }
    public void setReportCount(int reportCount) { this.reportCount = reportCount; }
    public void setSyncError(String syncError) { this.syncError = syncError; }
    public void setRemoved(OffsetDateTime removedAt, OffsetDateTime purgeAfter) {
        this.removedAt = removedAt;
        this.purgeAfter = purgeAfter;
    }
}
