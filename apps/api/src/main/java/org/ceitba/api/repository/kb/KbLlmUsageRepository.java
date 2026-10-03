package org.ceitba.api.repository.kb;

import org.ceitba.api.domain.kb.KbLlmUsage;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

public interface KbLlmUsageRepository extends JpaRepository<KbLlmUsage, UUID> {

    List<KbLlmUsage> findByCreatedAtBetween(OffsetDateTime from, OffsetDateTime to);

    List<KbLlmUsage> findByRunIdIn(Collection<UUID> runIds);

    List<KbLlmUsage> findByEvalId(UUID evalId);

    // Recorded cost of pipeline runs (frozen at their prices; evals not
    // included) since `since`.
    @org.springframework.data.jpa.repository.Query(
        "select coalesce(sum(u.costUsd), 0) from KbLlmUsage u where u.runId is not null and u.createdAt >= :since")
    java.math.BigDecimal sumCostSince(@org.springframework.data.repository.query.Param("since") OffsetDateTime since);
}
