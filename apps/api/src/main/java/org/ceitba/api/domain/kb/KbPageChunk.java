package org.ceitba.api.domain.kb;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.CreationTimestamp;

import java.time.OffsetDateTime;
import java.util.UUID;

// One embedded chunk of a wiki page (V61, KbChunker). The `embedding`
// (pgvector) column is deliberately not mapped: Hibernate's validate mode
// ignores unmapped columns, and vectors are only written and compared through
// the native queries of KbPageChunkRepository. Rows are never written through
// this entity.
@Entity
@Table(schema = "wiki", name = "kb_page_chunk")
public class KbPageChunk {

    // Length of kb_page_chunk.embedding (vector(768), EmbeddingGemma 2's native
    // size). A model with another length needs a migration.
    public static final int DIMENSIONS = 768;

    @Id
    private UUID id;

    @Column(name = "page_id", nullable = false)
    private UUID pageId;

    @Column(name = "page_revision", nullable = false)
    private int pageRevision;

    @Column(nullable = false)
    private int ordinal;

    @Column(columnDefinition = "text")
    private String heading;

    @Column(length = 256)
    private String anchor;

    @Column(nullable = false, columnDefinition = "text")
    private String content;

    @Column(nullable = false, length = 128)
    private String model;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    protected KbPageChunk() {}

    public UUID getId() { return id; }
    public UUID getPageId() { return pageId; }
    public int getPageRevision() { return pageRevision; }
    public int getOrdinal() { return ordinal; }
    public String getHeading() { return heading; }
    public String getAnchor() { return anchor; }
    public String getContent() { return content; }
    public String getModel() { return model; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
}
