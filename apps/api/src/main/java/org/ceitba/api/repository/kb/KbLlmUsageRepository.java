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

    // Sync calls of a model-id prefix since `since`: [calls, calls with no output,
    // p50 latency ms, p95 latency ms, output tokens, latency ms] (the last two over
    // calls that have a latency; their ratio is the per-request output tok/s).
    @org.springframework.data.jpa.repository.Query(value = """
        select count(*),
               count(*) filter (where output_tokens = 0),
               percentile_cont(0.5) within group (order by latency_ms),
               percentile_cont(0.95) within group (order by latency_ms),
               coalesce(sum(output_tokens) filter (where latency_ms > 0), 0),
               coalesce(sum(latency_ms) filter (where latency_ms > 0), 0)
        from wiki.kb_llm_usage
        where starts_with(model, :prefix) and created_at >= :since and mode = 'SYNC'
        """, nativeQuery = true)
    List<Object[]> endpointStats(@org.springframework.data.repository.query.Param("prefix") String prefix,
                                 @org.springframework.data.repository.query.Param("since") OffsetDateTime since);
}
