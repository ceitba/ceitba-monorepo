package org.ceitba.api.repository.capability;

import org.ceitba.api.domain.capability.CapabilityOrgGrant;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.UUID;

public interface CapabilityOrgGrantRepository
        extends JpaRepository<CapabilityOrgGrant, CapabilityOrgGrant.Id> {

    // Capabilities granted to any organization the user belongs to.
    @Query("""
        SELECT DISTINCT g.capability FROM CapabilityOrgGrant g, UserOrganization m
        WHERE m.userId = :userId AND m.organization = g.orgSlug
        """)
    List<String> findCapabilitiesByMember(@Param("userId") UUID userId);

    List<CapabilityOrgGrant> findByCapabilityOrderByOrgSlug(String capability);

    long countByCapability(String capability);
}
