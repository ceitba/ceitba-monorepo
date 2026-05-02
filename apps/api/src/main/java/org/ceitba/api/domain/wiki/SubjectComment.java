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
@Table(schema = "wiki", name = "subject_comment")
public class SubjectComment {

    @Id
    private UUID id;

    @Column(name = "subject_id", nullable = false, length = 25)
    private String subjectId;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(nullable = false, columnDefinition = "text")
    private String content;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    protected SubjectComment() {}

    public SubjectComment(UUID id, String subjectId, UUID userId, String content) {
        this.id = id;
        this.subjectId = subjectId;
        this.userId = userId;
        this.content = content;
    }

    public UUID getId() { return id; }
    public String getSubjectId() { return subjectId; }
    public UUID getUserId() { return userId; }
    public String getContent() { return content; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
    public OffsetDateTime getUpdatedAt() { return updatedAt; }

    public void setContent(String content) { this.content = content; }
}
