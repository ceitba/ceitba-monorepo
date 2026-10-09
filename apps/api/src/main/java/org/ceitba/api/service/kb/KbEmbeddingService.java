package org.ceitba.api.service.kb;

import org.ceitba.api.common.exception.FeatureNotConfiguredException;
import org.ceitba.api.common.exception.ValidationException;
import org.ceitba.api.config.KbEmbeddingProperties;
import org.ceitba.api.domain.kb.KbPageChunk;
import org.ceitba.api.domain.kb.KbPageStatus;
import org.ceitba.api.external.llm.EmbeddingClient;
import org.ceitba.api.external.llm.EmbeddingUnreachableException;
import org.ceitba.api.external.llm.LlmApiException;
import org.ceitba.api.repository.kb.KbPageChunkRepository;
import org.ceitba.api.repository.kb.KbPageRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.UUID;

// Embeddings of the wiki pages (docs/SUBJECT-WIKI.md "Embeddings").
//
// Indexing: embedPending() finds PUBLISHED pages without chunks for their
// current revision and the configured model, cuts them (KbChunker), embeds the
// chunks and replaces the page's rows. Imports and the pipeline only bump
// kb_page.revision; nothing calls this from their transactions. The HTTP call
// runs outside any transaction; the write re-checks the revision, so a page
// edited meanwhile is left for the next sweep.
//
// Search: search() embeds the query and returns the nearest chunks of
// PUBLISHED pages (cosine distance), for RAG.
@Service
public class KbEmbeddingService {

    private static final Logger log = LoggerFactory.getLogger(KbEmbeddingService.class);

    static final int SWEEP_PAGE = 100;
    public static final int MAX_K = 50;

    private final KbPageRepository pages;
    private final KbPageChunkRepository chunks;
    private final EmbeddingClient client;
    private final KbEmbeddingProperties props;
    private final TransactionTemplate tx;
    private final TransactionTemplate readTx;

    public KbEmbeddingService(KbPageRepository pages, KbPageChunkRepository chunks, EmbeddingClient client,
                              KbEmbeddingProperties props, PlatformTransactionManager txManager) {
        this.pages = pages;
        this.chunks = chunks;
        this.client = client;
        this.props = props;
        this.tx = new TransactionTemplate(txManager);
        this.readTx = new TransactionTemplate(txManager);
        this.readTx.setReadOnly(true);
    }

    public record SweepResult(int embedded, int failed, int remaining) {}

    // One chunk near a query; distance = cosine distance (0 = same direction, 2 = opposite).
    public record Hit(UUID chunkId, UUID pageId, String subjectId, String slug, String title, String heading,
                      String anchor, String content, double distance) {}

    public boolean available() {
        return client.available();
    }

    public String model() {
        return props.model();
    }

    // Embeds every pending page. Each page is tried at most once per sweep: one
    // that fails is logged and retried on the next sweep, and one that is still
    // pending after its write (edited meanwhile) waits for it too. An endpoint
    // problem ends the sweep.
    public SweepResult embedPending() {
        if (!client.available()) return new SweepResult(0, 0, 0);
        var seen = new HashSet<UUID>();
        var failed = new HashSet<UUID>();
        int embedded = 0;
        sweep:
        while (true) {
            var ids = readTx.execute(s -> chunks.findPageIdsToEmbed(props.model(), SWEEP_PAGE + seen.size()));
            var todo = ids.stream().filter(seen::add).toList();
            if (todo.isEmpty()) break;
            for (var id : todo) {
                try {
                    if (embedPage(id)) embedded++;
                } catch (LlmApiException e) {
                    failed.add(id);
                    // Server down, bad key, unknown model or wrong vector length: every
                    // page would fail the same way.
                    if (endpointProblem(e)) {
                        log.warn("KB embeddings: endpoint unreachable or misconfigured, stopping this sweep: {}",
                            e.getMessage());
                        break sweep;
                    }
                    log.warn("KB embeddings: page {} failed: {}", id, e.getMessage());
                } catch (RuntimeException e) {
                    log.warn("KB embeddings: page {} failed: {}", id, e.getMessage());
                    failed.add(id);
                }
            }
        }
        long remaining = readTx.execute(s -> chunks.countPagesToEmbed(props.model()));
        if (embedded > 0 || !failed.isEmpty()) {
            log.info("KB embeddings ({}): {} pages embedded, {} failed, {} pending", props.model(), embedded,
                failed.size(), remaining);
        }
        return new SweepResult(embedded, failed.size(), (int) remaining);
    }

    // Errors about the endpoint, not the page: they end the sweep. Anything else
    // (a 400 for one input, a malformed answer, a non-finite value) skips only
    // that page, so one bad page can never hold the rest back.
    static boolean endpointProblem(LlmApiException e) {
        return e instanceof EmbeddingUnreachableException || e instanceof DimensionMismatchException
            || e.status() == 401 || e.status() == 403 || e.status() == 404;
    }

    static final class DimensionMismatchException extends LlmApiException {
        DimensionMismatchException(String message) {
            super(0, message);
        }
    }

    // Embeds one page's current revision; false when it changed or stopped
    // being PUBLISHED while the vectors were computed (nothing written).
    boolean embedPage(UUID pageId) {
        record Snapshot(int revision, List<KbChunker.Chunk> chunks) {}
        var snap = readTx.execute(s -> pages.findById(pageId)
            .filter(p -> p.getStatus() == KbPageStatus.PUBLISHED)
            .map(p -> new Snapshot(p.getRevision(), KbChunker.chunk(p.getTitle(), p.getSummary(), p.getMarkdown())))
            .orElse(null));
        if (snap == null) return false;

        var vectors = embedAll(snap.chunks().stream().map(c -> props.document(c.title(), c.body())).toList());

        Boolean written = tx.execute(s -> {
            var page = pages.findById(pageId).orElse(null);
            if (page == null || page.getStatus() != KbPageStatus.PUBLISHED || page.getRevision() != snap.revision()) {
                return false;
            }
            chunks.deleteByPageId(pageId);
            for (int i = 0; i < snap.chunks().size(); i++) {
                var c = snap.chunks().get(i);
                chunks.insert(pageId, snap.revision(), c.ordinal(), c.heading(), c.anchor(), c.text(), props.model(),
                    literal(vectors.get(i)));
            }
            return true;
        });
        return Boolean.TRUE.equals(written);
    }

    // The nearest chunks to `query` (subjectId null = every subject).
    public List<Hit> search(String query, String subjectId, int k) {
        if (!client.available()) {
            throw new FeatureNotConfiguredException("Wiki search needs an embedding server (KB_EMBEDDING_BASE_URL)");
        }
        if (query == null || query.isBlank()) throw new ValidationException("query", query, "is required");
        int limit = Math.max(1, Math.min(k, MAX_K));
        var q = literal(embedAll(List.of(props.query(query.strip()))).get(0));
        return readTx.execute(s -> {
            chunks.enableIterativeScan();
            var out = new ArrayList<Hit>();
            for (var r : chunks.findNearest(q, props.model(), subjectId, limit)) {
                out.add(new Hit((UUID) r[0], (UUID) r[1], (String) r[2], (String) r[3], (String) r[4], (String) r[5],
                    (String) r[6], (String) r[7], ((Number) r[8]).doubleValue()));
            }
            return out;
        });
    }

    private List<float[]> embedAll(List<String> texts) {
        var out = new ArrayList<float[]>(texts.size());
        for (int i = 0; i < texts.size(); i += props.batchSize()) {
            var batch = texts.subList(i, Math.min(texts.size(), i + props.batchSize()));
            var vectors = client.embed(props.model(), batch);
            if (vectors.size() != batch.size()) {
                throw new LlmApiException(0, "embeddings: " + vectors.size() + " vectors for " + batch.size() + " inputs");
            }
            for (var v : vectors) {
                if (v.length != KbPageChunk.DIMENSIONS) {
                    throw new DimensionMismatchException("embeddings: model " + props.model() + " returned " + v.length
                        + " dimensions, the column holds " + KbPageChunk.DIMENSIONS);
                }
            }
            out.addAll(vectors);
        }
        return out;
    }

    // pgvector text form: [0.1,0.2,...].
    static String literal(float[] v) {
        var sb = new StringBuilder(v.length * 12).append('[');
        for (int i = 0; i < v.length; i++) {
            if (!Float.isFinite(v[i])) throw new LlmApiException(0, "embeddings: non-finite value in vector");
            if (i > 0) sb.append(',');
            sb.append(v[i]);
        }
        return sb.append(']').toString();
    }
}
