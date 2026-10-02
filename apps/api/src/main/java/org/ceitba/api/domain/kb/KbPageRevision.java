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
import org.hibernate.type.SqlTypes;

import java.time.OffsetDateTime;
import java.util.UUID;

// A page as it was before an import changed it.
@Entity
@Table(schema = "wiki", name = "kb_page_revision")
public class KbPageRevision {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "page_id", nullable = false)
    private UUID pageId;

    @Column(nullable = false)
    private int revision;

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

    @Column(nullable = false, length = 128)
    private String generator;

    @Column(name = "generated_at", nullable = false)
    private OffsetDateTime generatedAt;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    protected KbPageRevision() {}

    public static KbPageRevision of(KbPage p) {
        var r = new KbPageRevision();
        r.pageId = p.getId();
        r.revision = p.getRevision();
        r.type = p.getType();
        r.title = p.getTitle();
        r.summary = p.getSummary();
        r.aliases = StringArrays.fromList(p.getAliases());
        r.markdown = p.getMarkdown();
        r.sources = p.getSources().toArray(UUID[]::new);
        r.generator = p.getGenerator();
        r.generatedAt = p.getGeneratedAt();
        return r;
    }

    public UUID getId() { return id; }
    public UUID getPageId() { return pageId; }
    public int getRevision() { return revision; }
    public String getMarkdown() { return markdown; }
}
