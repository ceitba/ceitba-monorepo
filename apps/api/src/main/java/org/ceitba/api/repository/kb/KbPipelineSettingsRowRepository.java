package org.ceitba.api.repository.kb;

import org.ceitba.api.domain.kb.KbPipelineSettingsRow;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface KbPipelineSettingsRowRepository extends JpaRepository<KbPipelineSettingsRow, Integer> {
}
