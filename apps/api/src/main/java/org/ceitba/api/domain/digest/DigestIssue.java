package org.ceitba.api.domain.digest;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.ceitba.api.domain.StringArrays;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

// One "La semana en ITBA" issue per covered week (docs/WEEKLY-DIGEST.md).
@Entity
@Table(schema = "public", name = "digest_issues")
public class DigestIssue {

    public static final String DRAFT = "draft";
    public static final String SENDING = "sending";
    public static final String SENT = "sent";
    public static final String CANCELLED = "cancelled";

    @Id
    private UUID id;

    // Monday of the covered week.
    @Column(name = "week_start", nullable = false, unique = true)
    private LocalDate weekStart;

    @Column(nullable = false)
    private String subject;

    @Column
    private String intro;

    // String[] (not List<String>) for TEXT[]: see BenefitCard#bulletsEs and
    // ListStringMappingOrderIT.
    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(name = "excluded_article_ids", columnDefinition = "text[]", nullable = false)
    private String[] excludedArticleIds = new String[0];

    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(name = "excluded_event_ids", columnDefinition = "text[]", nullable = false)
    private String[] excludedEventIds = new String[0];

    @Column(nullable = false)
    private String status = DRAFT;

    @Column(name = "auto_send_at")
    private OffsetDateTime autoSendAt;

    @Column(name = "sent_at")
    private OffsetDateTime sentAt;

    @Column(name = "sent_by")
    private UUID sentBy;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    protected DigestIssue() {}

    public DigestIssue(UUID id, LocalDate weekStart, String subject) {
        this.id = id;
        this.weekStart = weekStart;
        this.subject = subject;
    }

    public UUID getId() { return id; }
    public LocalDate getWeekStart() { return weekStart; }
    public String getSubject() { return subject; }
    public String getIntro() { return intro; }
    public List<String> getExcludedArticleIds() { return StringArrays.toList(excludedArticleIds); }
    public List<String> getExcludedEventIds() { return StringArrays.toList(excludedEventIds); }
    public String getStatus() { return status; }
    public OffsetDateTime getAutoSendAt() { return autoSendAt; }
    public OffsetDateTime getSentAt() { return sentAt; }
    public UUID getSentBy() { return sentBy; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
    public OffsetDateTime getUpdatedAt() { return updatedAt; }

    public boolean isDraft() { return DRAFT.equals(status); }

    public void setSubject(String subject) { this.subject = subject; }
    public void setIntro(String intro) { this.intro = intro; }
    public void setExcludedArticleIds(List<String> ids) { this.excludedArticleIds = StringArrays.fromList(ids); }
    public void setExcludedEventIds(List<String> ids) { this.excludedEventIds = StringArrays.fromList(ids); }
    public void setStatus(String status) { this.status = status; }
    public void setAutoSendAt(OffsetDateTime autoSendAt) { this.autoSendAt = autoSendAt; }
    public void setSentBy(UUID sentBy) { this.sentBy = sentBy; }
}
