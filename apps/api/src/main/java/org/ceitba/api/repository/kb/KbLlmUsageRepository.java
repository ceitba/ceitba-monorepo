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
}
