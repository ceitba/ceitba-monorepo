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

    // [customId, model] of a stage's PENDING requests, without their params.
    @org.springframework.data.jpa.repository.Query("""
        select r.customId, r.model from KbRunRequest r
        where r.runId = :runId and r.stage = :stage and r.status = 'PENDING'
        order by r.customId
        """)
    List<Object[]> pendingIdsAndModels(@org.springframework.data.repository.query.Param("runId") UUID runId,
                                       @org.springframework.data.repository.query.Param("stage") String stage);

    // ---- paging helpers: ids first (no params), rows in pages, counts in SQL ----

    List<KbRunRequest> findByRunIdAndStageAndSubjectId(UUID runId, String stage, String subjectId);

    long countByRunIdAndStageAndStatusIn(UUID runId, String stage, Collection<String> statuses);

    @org.springframework.data.jpa.repository.Query("""
        select r.customId from KbRunRequest r where r.runId = :runId and r.stage = :stage order by r.customId
        """)
    List<String> idsByRunAndStage(@org.springframework.data.repository.query.Param("runId") UUID runId,
                                  @org.springframework.data.repository.query.Param("stage") String stage);

    @org.springframework.data.jpa.repository.Query("""
        select r.customId from KbRunRequest r
        where r.runId = :runId and r.stage = :stage and r.status in :statuses order by r.customId
        """)
    List<String> idsByRunStageStatus(@org.springframework.data.repository.query.Param("runId") UUID runId,
                                     @org.springframework.data.repository.query.Param("stage") String stage,
                                     @org.springframework.data.repository.query.Param("statuses") Collection<String> statuses);

    // SUBMITTED requests of a job (what a batch file carries).
    @org.springframework.data.jpa.repository.Query("""
        select r.customId from KbRunRequest r where r.batchJobId = :jobId and r.status = 'SUBMITTED' order by r.customId
        """)
    List<String> submittedIdsOfJob(@org.springframework.data.repository.query.Param("jobId") UUID jobId);

    // SUBMITTED requests of a job that got no answer yet (what a restart resumes).
    @org.springframework.data.jpa.repository.Query("""
        select r.customId from KbRunRequest r
        where r.batchJobId = :jobId and r.status = 'SUBMITTED' and r.completedAt is null order by r.customId
        """)
    List<String> unansweredIdsOfJob(@org.springframework.data.repository.query.Param("jobId") UUID jobId);

    @org.springframework.data.jpa.repository.Query("""
        select count(r) from KbRunRequest r
        where r.batchJobId = :jobId and r.status = 'SUBMITTED' and r.completedAt is null
        """)
    long countUnansweredOfJob(@org.springframework.data.repository.query.Param("jobId") UUID jobId);

    // Bulk: requests sent with a job (no entity loaded).
    @org.springframework.data.jpa.repository.Modifying
    @org.springframework.data.jpa.repository.Query("""
        update KbRunRequest r set r.status = 'SUBMITTED', r.batchJobId = :jobId, r.completedAt = null, r.latencyMs = null
        where r.customId in :ids
        """)
    int markSubmitted(@org.springframework.data.repository.query.Param("jobId") UUID jobId,
                      @org.springframework.data.repository.query.Param("ids") Collection<String> ids);

    // Bulk: a refused batch fails its requests that are still SUBMITTED.
    @org.springframework.data.jpa.repository.Modifying
    @org.springframework.data.jpa.repository.Query("""
        update KbRunRequest r set r.status = 'FAILED', r.error = :error
        where r.batchJobId = :jobId and r.status = 'SUBMITTED'
        """)
    int failSubmittedOfJob(@org.springframework.data.repository.query.Param("jobId") UUID jobId,
                           @org.springframework.data.repository.query.Param("error") String error);

    // [model, sum(est_tokens), sum(max_tokens)] of a stage's PENDING requests
    // (cost check without loading params).
    @org.springframework.data.jpa.repository.Query(value = """
        SELECT model, COALESCE(SUM(est_tokens), 0), COALESCE(SUM(COALESCE(CAST(params ->> 'max_tokens' AS bigint), 4096)), 0)
        FROM wiki.kb_run_request WHERE run_id = :runId AND stage = :stage AND status = 'PENDING' GROUP BY model
        """, nativeQuery = true)
    List<Object[]> pendingEstimate(@org.springframework.data.repository.query.Param("runId") UUID runId,
                                   @org.springframework.data.repository.query.Param("stage") String stage);

    // The same for these custom ids (a resubmission).
    @org.springframework.data.jpa.repository.Query(value = """
        SELECT model, COALESCE(SUM(est_tokens), 0), COALESCE(SUM(COALESCE(CAST(params ->> 'max_tokens' AS bigint), 4096)), 0)
        FROM wiki.kb_run_request WHERE custom_id IN (:ids) GROUP BY model
        """, nativeQuery = true)
    List<Object[]> estimateOf(@org.springframework.data.repository.query.Param("ids") Collection<String> ids);

    @org.springframework.data.jpa.repository.Modifying
    @org.springframework.data.jpa.repository.Query("delete from KbRunRequest r where r.customId in :ids")
    int deleteByCustomIds(@org.springframework.data.repository.query.Param("ids") Collection<String> ids);

    long countByRunIdAndStage(UUID runId, String stage);

    long countByRunIdAndStageAndStatus(UUID runId, String stage, String status);

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
