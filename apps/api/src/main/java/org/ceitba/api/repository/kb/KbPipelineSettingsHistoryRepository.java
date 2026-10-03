package org.ceitba.api.repository.kb;

import org.ceitba.api.domain.kb.KbPipelineSettingsHistory;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface KbPipelineSettingsHistoryRepository extends JpaRepository<KbPipelineSettingsHistory, UUID> {

    java.util.List<KbPipelineSettingsHistory> findAllByOrderByChangedAtDesc(org.springframework.data.domain.Pageable page);
}
