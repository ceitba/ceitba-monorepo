package org.ceitba.api.repository.news;

import jakarta.persistence.LockModeType;
import org.ceitba.api.domain.news.Organization;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;

public interface OrganizationRepository extends JpaRepository<Organization, String> {

    // Row-locked load: serializes an org's announcement sends (weekly cap).
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT o FROM Organization o WHERE o.slug = :slug")
    Optional<Organization> findByIdForUpdate(@Param("slug") String slug);
}
