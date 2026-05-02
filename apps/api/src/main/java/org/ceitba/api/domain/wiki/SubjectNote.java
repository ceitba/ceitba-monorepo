package org.ceitba.api.domain.wiki;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.OffsetDateTime;
import java.util.UUID;

@Entity
@Table(schema = "wiki", name = "subject_note")
public class SubjectNote {

    @Id
    private UUID id;

    @Column(name = "subject_id", nullable = false, length = 25)
    private String subjectId;

    @Column(name = "owner_name", nullable = false)
    private String ownerName;

    @Column(nullable = false, length = 1024)
    private String link;

    @Column(name = "uploader_id", nullable = false)
    private UUID uploaderId;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    protected SubjectNote() {}

    public SubjectNote(UUID id, String subjectId, String ownerName, String link, UUID uploaderId) {
        this.id = id;
        this.subjectId = subjectId;
        this.ownerName = ownerName;
        this.link = link;
        this.uploaderId = uploaderId;
    }

    public UUID getId() { return id; }
    public String getSubjectId() { return subjectId; }
    public String getOwnerName() { return ownerName; }
    public String getLink() { return link; }
    public UUID getUploaderId() { return uploaderId; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
    public OffsetDateTime getUpdatedAt() { return updatedAt; }
}
