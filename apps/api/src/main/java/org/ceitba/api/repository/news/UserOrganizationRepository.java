package org.ceitba.api.repository.news;

import org.ceitba.api.domain.news.UserOrganization;
import org.ceitba.api.domain.news.UserOrganizationId;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.UUID;

public interface UserOrganizationRepository
        extends JpaRepository<UserOrganization, UserOrganizationId> {

    List<UserOrganization> findByUserId(UUID userId);

    List<UserOrganization> findByOrganization(String organization);

    long countByOrganization(String organization);

    boolean existsByUserIdAndOrganization(UUID userId, String organization);

    boolean existsByUserIdAndOrganizationAndRole(UUID userId, String organization, String role);

    void deleteByUserIdAndOrganization(UUID userId, String organization);

    List<UserOrganization> findByOrganizationAndShowOnPortalTrueOrderByCreatedAt(String organization);

    // The org's admins, locked: the last-admin guard reads them under this
    // lock so two admins stepping down at once serialize and the second one
    // sees that it would leave the org without an admin.
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
        SELECT m FROM UserOrganization m
        WHERE m.organization = :org AND m.role = 'admin'
        ORDER BY m.userId
        """)
    List<UserOrganization> findAdminsForUpdate(@Param("org") String organization);
}
