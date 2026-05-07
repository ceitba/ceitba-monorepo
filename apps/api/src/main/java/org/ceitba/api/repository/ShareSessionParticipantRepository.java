package org.ceitba.api.repository;

import org.ceitba.api.domain.ShareSessionParticipant;
import org.ceitba.api.domain.ShareSessionParticipantId;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface ShareSessionParticipantRepository
        extends JpaRepository<ShareSessionParticipant, ShareSessionParticipantId> {

    List<ShareSessionParticipant> findBySessionIdOrderByJoinedAtAsc(UUID sessionId);

    long countBySessionId(UUID sessionId);
}
