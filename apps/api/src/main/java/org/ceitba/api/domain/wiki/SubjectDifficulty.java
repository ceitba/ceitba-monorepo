package org.ceitba.api.domain.wiki;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.OffsetDateTime;
import java.util.UUID;

@Entity
@Table(schema = "wiki", name = "subject_difficulty")
@IdClass(SubjectDifficultyId.class)
public class SubjectDifficulty {

    @Id
    @Column(name = "subject_id", length = 25)
    private String subjectId;

    @Id
    @Column(name = "user_id")
    private UUID userId;

    @Column(nullable = false)
    private int value;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    protected SubjectDifficulty() {}

    public SubjectDifficulty(String subjectId, UUID userId, int value) {
        this.subjectId = subjectId;
        this.userId = userId;
        this.value = value;
    }

    public String getSubjectId() { return subjectId; }
    public UUID getUserId() { return userId; }
    public int getValue() { return value; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
    public OffsetDateTime getUpdatedAt() { return updatedAt; }

    public void setValue(int value) { this.value = value; }
}
