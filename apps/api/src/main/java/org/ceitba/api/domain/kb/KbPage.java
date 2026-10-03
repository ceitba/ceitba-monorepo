package org.ceitba.api.domain.kb;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.ceitba.api.domain.StringArrays;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

import java.time.OffsetDateTime;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;

// One subject-wiki page (V33). Arrays are String[]/UUID[] fields, not
// List<String>, for the reason in PlanSubject (ListStringMappingOrderIT).
@Entity
@Table(schema = "wiki", name = "kb_page")
public class KbPage {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "subject_id", nullable = false, length = 25)
    private String subjectId;

    @Column(nullable = false, length = 128)
    private String slug;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private KbPageType type;

    @Column(nullable = false, columnDefinition = "text")
    private String title;

    @Column(nullable = false, columnDefinition = "text")
    private String summary;

    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(nullable = false, columnDefinition = "text[]")
    private String[] aliases = new String[0];

    @Column(nullable = false, columnDefinition = "text")
    private String markdown;

    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(nullable = false, columnDefinition = "uuid[]")
    private UUID[] sources = new UUID[0];

    @Column(nullable = false)
    private int revision = 1;

    @Column(nullable = false, length = 128)
    private String generator;

    @Column(name = "generated_at", nullable = false)
    private OffsetDateTime generatedAt;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private KbPageStatus status = KbPageStatus.PUBLISHED;

    @Column(name = "report_count", nullable = false)
    private int reportCount;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    protected KbPage() {}

    public KbPage(String subjectId, String slug) {
        this.subjectId = subjectId;
        this.slug = slug;
    }

    // Whether `content` differs from what the page holds now.
    public boolean differsFrom(KbPageType type, String title, String summary, List<String> aliases, String markdown,
                               List<UUID> sources, String generator, OffsetDateTime generatedAt) {
        return this.type != type || !title.equals(this.title) || !summary.equals(this.summary)
            || !aliases.equals(getAliases()) || !markdown.equals(this.markdown) || !sources.equals(getSources())
            || !generator.equals(this.generator) || !generatedAt.isEqual(this.generatedAt);
    }

    public void setContent(KbPageType type, String title, String summary, List<String> aliases, String markdown,
                           List<UUID> sources, String generator, OffsetDateTime generatedAt) {
        this.type = type;
        this.title = title;
        this.summary = summary;
        this.aliases = StringArrays.fromList(aliases);
        this.markdown = markdown;
        this.sources = sources.toArray(UUID[]::new);
        this.generator = generator;
        this.generatedAt = generatedAt;
    }

    public UUID getId() { return id; }
    public String getSubjectId() { return subjectId; }
    public String getSlug() { return slug; }
    public KbPageType getType() { return type; }
    public String getTitle() { return title; }
    public String getSummary() { return summary; }
    public List<String> getAliases() { return StringArrays.toList(aliases); }
    public String getMarkdown() { return markdown; }
    public List<UUID> getSources() { return sources == null ? List.of() : List.copyOf(Arrays.asList(sources)); }
    public int getRevision() { return revision; }
    public String getGenerator() { return generator; }
    public OffsetDateTime getGeneratedAt() { return generatedAt; }
    public KbPageStatus getStatus() { return status; }
    public int getReportCount() { return reportCount; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
    public OffsetDateTime getUpdatedAt() { return updatedAt; }

    public void setRevision(int revision) { this.revision = revision; }
    public void setStatus(KbPageStatus status) { this.status = status; }
    public void setReportCount(int reportCount) { this.reportCount = reportCount; }
}
