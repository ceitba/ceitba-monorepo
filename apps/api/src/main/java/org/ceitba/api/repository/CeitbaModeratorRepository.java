package org.ceitba.api.repository;

import org.ceitba.api.domain.CeitbaModerator;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.UUID;

public interface CeitbaModeratorRepository extends JpaRepository<CeitbaModerator, UUID> {

    @Query("""
        SELECT (count(m) > 0) FROM CeitbaModerator m
        WHERE m.userId = :userId AND m.revokedAt IS NULL
        """)
    boolean isActiveModerator(@Param("userId") UUID userId);

    List<CeitbaModerator> findByRevokedAtIsNullOrderByGrantedAtAsc();
}
