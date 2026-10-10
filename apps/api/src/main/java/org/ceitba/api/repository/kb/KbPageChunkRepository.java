package org.ceitba.api.repository.kb;

import org.ceitba.api.domain.kb.KbPageChunk;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.UUID;

// Vectors travel as pgvector text literals ("[0.1,0.2,...]", KbEmbeddingService.literal)
// cast in SQL: the embedding column has no JPA mapping (see KbPageChunk).
public interface KbPageChunkRepository extends JpaRepository<KbPageChunk, UUID> {

    // PUBLISHED pages with no chunks for their current revision and `model`
    // (new, edited, restored before ever being embedded, or a model change),
    // oldest change first.
    @Query(value = """
        SELECT p.id FROM wiki.kb_page p
        WHERE p.status = 'PUBLISHED'
          AND NOT EXISTS (SELECT 1 FROM wiki.kb_page_chunk c
                          WHERE c.page_id = p.id AND c.page_revision = p.revision AND c.model = :model)
        ORDER BY p.updated_at, p.id
        LIMIT :limit
        """, nativeQuery = true)
    List<UUID> findPageIdsToEmbed(@Param("model") String model, @Param("limit") int limit);

    @Query(value = """
        SELECT count(*) FROM wiki.kb_page p
        WHERE p.status = 'PUBLISHED'
          AND NOT EXISTS (SELECT 1 FROM wiki.kb_page_chunk c
                          WHERE c.page_id = p.id AND c.page_revision = p.revision AND c.model = :model)
        """, nativeQuery = true)
    long countPagesToEmbed(@Param("model") String model);

    @Modifying
    @Query(value = "DELETE FROM wiki.kb_page_chunk WHERE page_id = :pageId", nativeQuery = true)
    int deleteByPageId(@Param("pageId") UUID pageId);

    // Casts on the nullable text parameters: an untyped null would bind as bytea.
    @Modifying
    @Query(value = """
        INSERT INTO wiki.kb_page_chunk (page_id, page_revision, ordinal, heading, anchor, content, model, embedding)
        VALUES (:pageId, :revision, :ordinal, CAST(:heading AS text), CAST(:anchor AS varchar), :content, :model,
                CAST(:embedding AS vector))
        """, nativeQuery = true)
    int insert(@Param("pageId") UUID pageId, @Param("revision") int revision, @Param("ordinal") int ordinal,
               @Param("heading") String heading, @Param("anchor") String anchor, @Param("content") String content,
               @Param("model") String model, @Param("embedding") String embedding);

    // Lets an HNSW scan keep going until `k` rows pass the filters (pgvector
    // 0.8 iterative scans); otherwise a filtered search can return fewer than
    // k hits. strict_order keeps results in exact distance order (relaxed_order
    // may not). Transaction-local.
    @Query(value = "SELECT set_config('hnsw.iterative_scan', 'strict_order', true)", nativeQuery = true)
    String enableIterativeScan();

    // [chunk id, page id, subject id, slug, page title, heading, anchor,
    // content, cosine distance] of the `k` chunks nearest to `query`, among
    // PUBLISHED pages' chunks for `model`; subjectId null = all subjects. An
    // edited page keeps its previous revision's chunks until the next sweep
    // replaces them (better slightly stale than missing).
    @Query(value = """
        SELECT c.id, p.id AS page_id, p.subject_id, p.slug, p.title, c.heading, c.anchor, c.content,
               c.embedding <=> CAST(:query AS vector) AS distance
        FROM wiki.kb_page_chunk c
        JOIN wiki.kb_page p ON p.id = c.page_id
        WHERE p.status = 'PUBLISHED' AND c.model = :model
          AND (CAST(:subjectId AS varchar) IS NULL OR p.subject_id = CAST(:subjectId AS varchar))
        ORDER BY c.embedding <=> CAST(:query AS vector)
        LIMIT :k
        """, nativeQuery = true)
    List<Object[]> findNearest(@Param("query") String query, @Param("model") String model,
                               @Param("subjectId") String subjectId, @Param("k") int k);
}
