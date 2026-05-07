package org.ceitba.api.repository;

import org.ceitba.api.domain.ShareSession;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface ShareSessionRepository extends JpaRepository<ShareSession, UUID> {

    Optional<ShareSession> findByToken(String token);

    boolean existsByToken(String token);
}
