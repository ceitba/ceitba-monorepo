package org.ceitba.api.repository.kb;

import org.ceitba.api.domain.kb.KbRunRequest;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

public interface KbRunRequestRepository extends JpaRepository<KbRunRequest, String> {

    List<KbRunRequest> findByRunIdAndStage(UUID runId, String stage);

    List<KbRunRequest> findByRunIdAndStageAndStatusIn(UUID runId, String stage, Collection<String> statuses);

    List<KbRunRequest> findByBatchJobId(UUID batchJobId);

    long countByRunId(UUID runId);

    // [model, stage, outputTokens] of answers since `since` (latest first).
    @org.springframework.data.jpa.repository.Query(value = """
        SELECT model, stage, tokens_out FROM wiki.kb_run_request
        WHERE status = 'DONE' AND tokens_out > 0 AND created_at >= :since
        ORDER BY created_at DESC LIMIT 5000
        """, nativeQuery = true)
    List<Object[]> recentOutputTokens(@org.springframework.data.repository.query.Param("since") java.time.OffsetDateTime since);

    // [model, requests, empty-or-truncated answers] over each model's last
    // 200 answered (or failed) structured requests.
    @org.springframework.data.jpa.repository.Query(value = """
        SELECT model, count(*),
               count(*) FILTER (WHERE error LIKE 'EMPTY_TOOL%' OR error LIKE 'TRUNCATED%' OR exec_path LIKE '%+retry')
        FROM (SELECT model, error, exec_path,
                     row_number() OVER (PARTITION BY model ORDER BY created_at DESC) AS rn
              FROM wiki.kb_run_request WHERE status IN ('DONE', 'FAILED')) t
        WHERE rn <= 200 GROUP BY model
        """, nativeQuery = true)
    List<Object[]> emptyToolCallStats();

    // Progress rows without payloads: [stage, status, failedAnswer, estTokens,
    // model, createdAt, completedAt (else the first usage row's time),
    // latencyMs, target, subjectId].
    @org.springframework.data.jpa.repository.Query(value = """
        SELECT r.stage, r.status, (r.status = 'SUBMITTED' AND r.error IS NOT NULL), r.est_tokens, r.model,
               r.created_at,
               COALESCE(r.completed_at, (SELECT min(u.created_at) FROM wiki.kb_llm_usage u
                                         WHERE u.request_id = r.custom_id)),
               r.latency_ms, r.target, r.subject_id
        FROM wiki.kb_run_request r WHERE r.run_id = :runId
        """, nativeQuery = true)
    List<Object[]> progressRows(@org.springframework.data.repository.query.Param("runId") java.util.UUID runId);

    // Privacy: drops the raw text (params) and digest (result) of the DIGEST
    // requests of deleted files (target = file id). No persistence-context
    // clear: callers hold Drive entities in the same transaction.
    @org.springframework.data.jpa.repository.Modifying
    @org.springframework.data.jpa.repository.Query(value = """
        UPDATE wiki.kb_run_request SET params = CAST('{}' AS jsonb), result = NULL
        WHERE stage = 'DIGEST' AND target IN (:targets)
        """, nativeQuery = true)
    int redactDigestRequests(@org.springframework.data.repository.query.Param("targets") Collection<String> targets);
}
