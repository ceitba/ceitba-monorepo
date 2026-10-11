package org.ceitba.api.service.kb;

import org.ceitba.api.common.exception.ValidationException;
import org.ceitba.api.domain.User;
import org.ceitba.api.service.ratelimit.UserRateLimiter;
import org.ceitba.api.web.kb.dto.KbSearchResponse;
import org.springframework.stereotype.Service;

// Semantic search over the subject wikis (docs/SUBJECT-WIKI.md "Embeddings"):
// the building block for RAG in clients such as apps/mcp. Every query costs an
// embedding call, so it has a per-user quota (rate-limit.user-rules.wiki-search).
// Not @Transactional: KbEmbeddingService.search embeds the query over HTTP and
// then reads in its own read-only transaction.
@Service
public class KbSearchService {

    public static final String RATE_RULE = "wiki-search";
    public static final int DEFAULT_LIMIT = 8;
    public static final int MAX_LIMIT = 20;
    public static final int MAX_QUERY_LENGTH = 500;

    private final KbEmbeddingService embeddings;
    private final UserRateLimiter rateLimiter;

    public KbSearchService(KbEmbeddingService embeddings, UserRateLimiter rateLimiter) {
        this.embeddings = embeddings;
        this.rateLimiter = rateLimiter;
    }

    public KbSearchResponse search(User user, String query, String subjectId, Integer limit) {
        String q = query == null ? "" : query.strip();
        if (q.isEmpty()) throw new ValidationException("q", query, "is required");
        if (q.length() > MAX_QUERY_LENGTH) throw new ValidationException("q", q.length() + " characters", "must be at most " + MAX_QUERY_LENGTH + " characters");
        String subject = subjectId == null || subjectId.isBlank() ? null : subjectId.strip();
        int k = limit == null ? DEFAULT_LIMIT : Math.max(1, Math.min(limit, MAX_LIMIT));
        rateLimiter.consume(RATE_RULE, user.getId());
        var hits = embeddings.search(q, subject, k).stream()
            .map(h -> new KbSearchResponse.Hit(h.pageId(), h.subjectId(), h.slug(), h.title(), h.heading(),
                h.anchor(), h.content(), Math.round((1 - h.distance()) * 1000) / 1000.0))
            .toList();
        return new KbSearchResponse(q, hits);
    }
}
