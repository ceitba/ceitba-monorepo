package org.ceitba.api.repository.kb;

import org.ceitba.api.domain.kb.KbBatchJob;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface KbBatchJobRepository extends JpaRepository<KbBatchJob, UUID> {

    List<KbBatchJob> findByRunIdOrderByCreatedAtAsc(UUID runId);

    List<KbBatchJob> findByRunIdAndStage(UUID runId, String stage);
}
