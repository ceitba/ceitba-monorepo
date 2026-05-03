package org.ceitba.api.domain.wiki;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;

import java.time.OffsetDateTime;
import java.util.UUID;

@Entity
@Table(schema = "wiki", name = "subject_bookmarks")
@IdClass(SubjectBookmarkId.class)
public class SubjectBookmark {

    @Id
    @Column(name = "subject_id", length = 25)
    private String subjectId;

    @Id
    @Column(name = "user_id")
    private UUID userId;

    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt = OffsetDateTime.now();

    protected SubjectBookmark() {}

    public SubjectBookmark(String subjectId, UUID userId) {
        this.subjectId = subjectId;
        this.userId = userId;
    }

    public String getSubjectId() { return subjectId; }
    public UUID getUserId() { return userId; }
    public OffsetDateTime getUpdatedAt() { return updatedAt; }
}
