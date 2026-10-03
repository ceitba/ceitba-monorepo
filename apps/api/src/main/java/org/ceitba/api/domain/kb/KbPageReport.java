package org.ceitba.api.domain.kb;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;

import java.time.OffsetDateTime;
import java.util.UUID;

// One reader's report of a page; re-reporting replaces it.
@Entity
@IdClass(KbPageReportId.class)
@Table(schema = "wiki", name = "kb_page_report")
public class KbPageReport {

    @Id
    @Column(name = "page_id")
    private UUID pageId;

    @Id
    @Column(name = "user_id")
    private UUID userId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private KbReportReason reason;

    @Column(columnDefinition = "text")
    private String comment;

    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;

    protected KbPageReport() {}

    public KbPageReport(UUID pageId, UUID userId, KbReportReason reason, String comment, OffsetDateTime at) {
        this.pageId = pageId;
        this.userId = userId;
        this.reason = reason;
        this.comment = comment;
        this.createdAt = at;
    }

    public void update(KbReportReason reason, String comment, OffsetDateTime at) {
        this.reason = reason;
        this.comment = comment;
        this.createdAt = at;
    }

    public UUID getPageId() { return pageId; }
    public UUID getUserId() { return userId; }
}
