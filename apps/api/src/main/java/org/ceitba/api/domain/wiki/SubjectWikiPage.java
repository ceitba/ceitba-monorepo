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
@Table(schema = "wiki", name = "subject_wiki_page")
public class SubjectWikiPage {

    @Id
    @Column(name = "subject_id", length = 25)
    private String subjectId;

    @Column(nullable = false, columnDefinition = "text")
    private String content;

    @Column(name = "updated_by", nullable = false)
    private UUID updatedBy;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    protected SubjectWikiPage() {}

    public SubjectWikiPage(String subjectId, String content, UUID updatedBy) {
        this.subjectId = subjectId;
        this.content = content;
        this.updatedBy = updatedBy;
    }

    public String getSubjectId() { return subjectId; }
    public String getContent() { return content; }
    public UUID getUpdatedBy() { return updatedBy; }
    public OffsetDateTime getUpdatedAt() { return updatedAt; }
    public OffsetDateTime getCreatedAt() { return createdAt; }

    public void setContent(String content) { this.content = content; }
    public void setUpdatedBy(UUID updatedBy) { this.updatedBy = updatedBy; }
}
