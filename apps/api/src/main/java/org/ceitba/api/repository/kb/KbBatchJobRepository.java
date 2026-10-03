package org.ceitba.api.repository.kb;

import org.ceitba.api.domain.kb.KbBatchJob;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface KbBatchJobRepository extends JpaRepository<KbBatchJob, UUID> {

    List<KbBatchJob> findByRunIdOrderByCreatedAtAsc(UUID runId);

    List<KbBatchJob> findByRunIdAndStage(UUID runId, String stage);

    java.util.Optional<KbBatchJob> findByRunIdAndStageAndAttemptAndModel(UUID runId, String stage, int attempt,
                                                                         String model);

    // Runs waiting for a DO batch (the batch poller's work list): an open
    // batch, or a queued one whose (rate-limited) creation is due.
    @org.springframework.data.jpa.repository.Query("""
        select distinct j.runId from KbBatchJob j where j.mode = 'BATCH' and (j.status = 'SUBMITTED'
            or (j.status = 'QUEUED' and (j.nextAttemptAt is null or j.nextAttemptAt <= :now)))
        """)
    java.util.List<java.util.UUID> runsWithOpenBatches(
        @org.springframework.data.repository.query.Param("now") java.time.OffsetDateTime now);

    // Retention (KbRunRetentionService): [id, payload_key, output_key] of
    // finished jobs of finished runs created before `before` whose objects
    // are still on record.
    @org.springframework.data.jpa.repository.Query(value = """
        SELECT j.id, j.payload_key, j.output_key FROM wiki.kb_batch_job j
        JOIN wiki.kb_run r ON r.id = j.run_id
        WHERE j.created_at < :before AND (j.payload_key IS NOT NULL OR j.output_key IS NOT NULL)
          AND j.status IN ('COMPLETED', 'FAILED', 'CANCELLED', 'DRY')
          AND r.status NOT IN ('RUNNING', 'WAITING', 'BLOCKED_BY_COST_LIMIT')
        ORDER BY j.created_at LIMIT :limit
        """, nativeQuery = true)
    List<Object[]> expiredObjects(@org.springframework.data.repository.query.Param("before") java.time.OffsetDateTime before,
                                  @org.springframework.data.repository.query.Param("limit") int limit);

    @org.springframework.data.jpa.repository.Modifying
    @org.springframework.data.jpa.repository.Query(value = """
        UPDATE wiki.kb_batch_job SET payload_key = NULL, output_key = NULL WHERE id IN (:ids)
        """, nativeQuery = true)
    int clearObjectKeys(@org.springframework.data.repository.query.Param("ids") java.util.Collection<UUID> ids);
}
