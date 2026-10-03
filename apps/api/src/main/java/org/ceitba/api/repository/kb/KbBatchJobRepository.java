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
}
