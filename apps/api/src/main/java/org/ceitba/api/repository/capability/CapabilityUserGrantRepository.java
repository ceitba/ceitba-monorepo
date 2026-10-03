package org.ceitba.api.repository.capability;

import org.ceitba.api.domain.capability.CapabilityUserGrant;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface CapabilityUserGrantRepository
        extends JpaRepository<CapabilityUserGrant, CapabilityUserGrant.Id> {

    @Query("SELECT g.capability FROM CapabilityUserGrant g WHERE g.email = :email")
    List<String> findCapabilitiesByEmail(@Param("email") String email);

    List<CapabilityUserGrant> findByCapabilityOrderByEmail(String capability);

    long countByCapability(String capability);
}
