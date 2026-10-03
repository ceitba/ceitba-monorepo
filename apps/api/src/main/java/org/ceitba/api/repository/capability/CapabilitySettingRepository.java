package org.ceitba.api.repository.capability;

import org.ceitba.api.domain.capability.CapabilitySetting;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;

public interface CapabilitySettingRepository extends JpaRepository<CapabilitySetting, String> {

    @Query("SELECT s.capability FROM CapabilitySetting s WHERE s.enabledForAll = true")
    List<String> findEnabledForAll();
}
