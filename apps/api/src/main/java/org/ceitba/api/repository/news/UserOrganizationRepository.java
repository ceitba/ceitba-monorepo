package org.ceitba.api.repository.news;

import org.ceitba.api.domain.news.UserOrganization;
import org.ceitba.api.domain.news.UserOrganizationId;
import org.springframework.data.jpa.repository.JpaRepository;

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
}
