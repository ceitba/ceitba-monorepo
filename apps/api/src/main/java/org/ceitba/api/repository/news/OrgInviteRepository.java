package org.ceitba.api.repository.news;

import org.ceitba.api.domain.news.OrgInvite;
import org.ceitba.api.domain.news.OrgInviteId;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.UUID;

public interface OrgInviteRepository extends JpaRepository<OrgInvite, OrgInviteId> {

    List<OrgInvite> findByOrganizationOrderByEmail(String organization);

    // Re-inviting an email that is already pending only updates its role.
    @Modifying
    @Query(value = """
        INSERT INTO public.org_invites (org_slug, email, role, invited_by)
        VALUES (:org, :email, :role, :by)
        ON CONFLICT (org_slug, email) DO UPDATE SET role = EXCLUDED.role
        """, nativeQuery = true)
    void upsert(@Param("org") String org, @Param("email") String email,
                @Param("role") String role, @Param("by") UUID by);

    // Turns every pending invite of `email` into a membership of `userId`.
    // Idempotent: a membership that already exists is left as is.
    @Modifying
    @Query(value = """
        INSERT INTO public.user_organizations (user_id, org_slug, role, added_by)
        SELECT :userId, i.org_slug, i.role, i.invited_by
        FROM public.org_invites i WHERE i.email = :email
        ON CONFLICT DO NOTHING
        """, nativeQuery = true)
    int insertMembershipsFromInvites(@Param("userId") UUID userId, @Param("email") String email);

    @Modifying
    @Query("DELETE FROM OrgInvite i WHERE i.email = :email")
    int deleteByEmail(@Param("email") String email);

    @Modifying
    @Query("DELETE FROM OrgInvite i WHERE i.organization = :org AND i.email = :email")
    int deleteOne(@Param("org") String org, @Param("email") String email);
}
