package org.ceitba.api.repository.orgmail;

import org.ceitba.api.domain.orgmail.OrgMailOptout;
import org.ceitba.api.domain.orgmail.OrgMailOptoutId;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.UUID;

public interface OrgMailOptoutRepository extends JpaRepository<OrgMailOptout, OrgMailOptoutId> {

    // Idempotent, also under concurrent one-click unsubscribes.
    @Modifying
    @Query(value = """
        INSERT INTO public.org_mail_optouts (user_id, org_slug) VALUES (:userId, :org) ON CONFLICT DO NOTHING
        """, nativeQuery = true)
    int insertIfAbsent(@Param("userId") UUID userId, @Param("org") String org);
}
