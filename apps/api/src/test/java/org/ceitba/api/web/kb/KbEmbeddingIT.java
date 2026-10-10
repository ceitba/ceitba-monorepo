package org.ceitba.api.web.kb;

import org.ceitba.api.domain.kb.KbPageChunk;
import org.ceitba.api.external.llm.EmbeddingClient;
import org.ceitba.api.external.llm.FakeEmbeddingClient;
import org.ceitba.api.service.kb.KbEmbeddingService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

// Wiki embeddings end to end on the real image: pgvector is installed by
// Flyway (V61), the indexer chunks and embeds PUBLISHED pages (fake vectors:
// hashed bag of words), re-embeds a page when its revision changes, skips
// hidden pages, and kNN over the HNSW index finds the matching section.
@SpringBootTest
class KbEmbeddingIT {

    @Autowired JdbcTemplate jdbc;
    @Autowired KbEmbeddingService embeddings;
    @Autowired EmbeddingClient client;

    UUID vanId;
    UUID amortId;

    @BeforeEach
    void seed() {
        jdbc.execute("TRUNCATE wiki.kb_page, public.subject CASCADE");
        jdbc.update("INSERT INTO public.subject (id, name, credits, updated_at) VALUES "
            + "('61.12', 'Matemática Financiera', 3, now()), ('81.07', 'Contabilidad', 3, now())");
        vanId = page("61.12", "valor-actual-neto", "Valor actual neto", "Suma de flujos descontados.", """
            Intro.

            ## Cómo se calcula
            Se descuentan los flujos de fondos a la tasa de corte y se restan de la inversión inicial.

            ## Criterio de decisión
            Un proyecto conviene cuando el resultado es positivo.
            """);
        amortId = page("81.07", "amortizaciones", "Amortizaciones", "Depreciación de bienes de uso.", """
            ## Método de línea recta
            El valor residual se reparte en cuotas iguales durante la vida útil del bien de uso.
            """);
    }

    UUID page(String subject, String slug, String title, String summary, String markdown) {
        var id = UUID.randomUUID();
        jdbc.update("INSERT INTO wiki.kb_page (id, subject_id, slug, type, title, summary, markdown, generator, "
            + "generated_at) VALUES (?, ?, ?, 'CONCEPT', ?, ?, ?, 'test', now())", id, subject, slug, title, summary,
            markdown);
        return id;
    }

    @Test
    void extensionAndIndexExist() {
        assertThat(jdbc.queryForObject("SELECT extversion FROM pg_extension WHERE extname = 'vector'", String.class))
            .isNotBlank();
        assertThat(jdbc.queryForObject("SELECT indexdef FROM pg_indexes WHERE indexname = 'kb_page_chunk_embedding_idx'",
            String.class)).contains("hnsw").contains("vector_cosine_ops");
    }

    @Test
    void embedsPublishedPagesAndFindsTheMatchingSection() {
        var sweep = embeddings.embedPending();
        assertThat(sweep.embedded()).isEqualTo(2);
        assertThat(sweep.remaining()).isZero();

        // Chunk 0 + 2 sections for the VAN page, chunk 0 + 1 section for the other.
        assertThat(jdbc.queryForObject("SELECT count(*) FROM wiki.kb_page_chunk WHERE page_id = ?", Integer.class, vanId))
            .isEqualTo(3);
        assertThat(jdbc.queryForObject("SELECT vector_dims(embedding) FROM wiki.kb_page_chunk LIMIT 1", Integer.class))
            .isEqualTo(KbPageChunk.DIMENSIONS);
        assertThat(jdbc.queryForList("SELECT DISTINCT model FROM wiki.kb_page_chunk", String.class))
            .containsExactly(embeddings.model());

        var hits = embeddings.search("cómo se descuentan los flujos de fondos con la tasa de corte", null, 3);
        assertThat(hits).hasSize(3);
        assertThat(hits.get(0).slug()).isEqualTo("valor-actual-neto");
        assertThat(hits.get(0).anchor()).isEqualTo("como-se-calcula");
        assertThat(hits.get(0).distance()).isLessThan(hits.get(1).distance());

        var scoped = embeddings.search("vida útil del bien de uso", "81.07", 10);
        assertThat(scoped).isNotEmpty().allSatisfy(h -> assertThat(h.subjectId()).isEqualTo("81.07"));
        assertThat(scoped.get(0).anchor()).isEqualTo("metodo-de-linea-recta");

        // Nothing pending: a second sweep makes no requests.
        int calls = ((FakeEmbeddingClient) client).calls();
        assertThat(embeddings.embedPending().embedded()).isZero();
        assertThat(((FakeEmbeddingClient) client).calls()).isEqualTo(calls);
    }

    @Test
    void aNewRevisionReplacesThePageChunks() {
        embeddings.embedPending();
        jdbc.update("UPDATE wiki.kb_page SET markdown = ?, revision = revision + 1 WHERE id = ?",
            "## Solo una sección\nTexto nuevo sobre la tasa interna de retorno.\n", vanId);

        assertThat(embeddings.embedPending().embedded()).isEqualTo(1);
        assertThat(jdbc.queryForList("SELECT anchor FROM wiki.kb_page_chunk WHERE page_id = ? ORDER BY ordinal",
            String.class, vanId)).containsExactly(null, "solo-una-seccion");
        assertThat(jdbc.queryForObject("SELECT DISTINCT page_revision FROM wiki.kb_page_chunk WHERE page_id = ?",
            Integer.class, vanId)).isEqualTo(2);
    }

    @Test
    void hiddenPagesAreNeitherEmbeddedNorReturned() {
        jdbc.update("UPDATE wiki.kb_page SET status = 'HIDDEN', hidden_reason = 'STAFF' WHERE id = ?", amortId);
        assertThat(embeddings.embedPending().embedded()).isEqualTo(1);

        // Restored: embedded now; hidden again: its chunks stay but are never returned.
        jdbc.update("UPDATE wiki.kb_page SET status = 'PUBLISHED', hidden_reason = NULL WHERE id = ?", amortId);
        assertThat(embeddings.embedPending().embedded()).isEqualTo(1);
        jdbc.update("UPDATE wiki.kb_page SET status = 'HIDDEN', hidden_reason = 'STAFF' WHERE id = ?", amortId);

        assertThat(embeddings.search("vida útil del bien de uso", null, 10))
            .isNotEmpty().noneSatisfy(h -> assertThat(h.pageId()).isEqualTo(amortId));
    }
}
