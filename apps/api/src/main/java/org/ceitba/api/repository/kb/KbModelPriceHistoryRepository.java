package org.ceitba.api.repository.kb;

import org.ceitba.api.domain.kb.KbModelPriceHistory;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface KbModelPriceHistoryRepository extends JpaRepository<KbModelPriceHistory, UUID> {

    List<KbModelPriceHistory> findByModelIdOrderByChangedAtDesc(String modelId);
}
