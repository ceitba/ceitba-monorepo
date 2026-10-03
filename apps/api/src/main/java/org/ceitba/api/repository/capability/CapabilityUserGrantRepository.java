package org.ceitba.api.repository.capability;

import org.ceitba.api.domain.capability.CapabilityUserGrant;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public interface CapabilityUserGrantRepository
        extends JpaRepository<CapabilityUserGrant, CapabilityUserGrant.Id> {

    @Query("SELECT g.capability FROM CapabilityUserGrant g WHERE g.email = :email")
    List<String> findCapabilitiesByEmail(@Param("email") String email);

    List<CapabilityUserGrant> findByCapabilityOrderByEmail(String capability);

    long countByCapability(String capability);

    // Idempotent under concurrency: an existing (or concurrently inserted)
    // grant is left as is instead of failing on the primary key.
    @Modifying
    @Query(value = """
        INSERT INTO public.capability_user_grants (capability, email, granted_at, granted_by)
        VALUES (:capability, :email, :at, :by) ON CONFLICT DO NOTHING
        """, nativeQuery = true)
    int insertIfAbsent(@Param("capability") String capability, @Param("email") String email,
                       @Param("at") OffsetDateTime at, @Param("by") UUID by);
}
