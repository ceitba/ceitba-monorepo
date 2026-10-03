package org.ceitba.api.repository.capability;

import org.ceitba.api.domain.capability.CapabilityOrgGrant;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.OffsetDateTime;
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

    // Idempotent under concurrency (see CapabilityUserGrantRepository).
    @Modifying
    @Query(value = """
        INSERT INTO public.capability_org_grants (capability, org_slug, granted_at, granted_by)
        VALUES (:capability, :slug, :at, :by) ON CONFLICT DO NOTHING
        """, nativeQuery = true)
    int insertIfAbsent(@Param("capability") String capability, @Param("slug") String slug,
                       @Param("at") OffsetDateTime at, @Param("by") UUID by);
}
