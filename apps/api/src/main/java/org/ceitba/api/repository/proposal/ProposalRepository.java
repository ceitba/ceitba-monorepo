package org.ceitba.api.repository.proposal;

import jakarta.persistence.LockModeType;
import org.ceitba.api.domain.ProposalStatus;
import org.ceitba.api.domain.proposal.Proposal;
import org.ceitba.api.domain.proposal.ProposalTopic;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.UUID;

public interface ProposalRepository extends JpaRepository<Proposal, UUID> {

    // SELECT ... FOR UPDATE: serializes vote/comment/moderation writes on one
    // proposal so counters and alias uniqueness stay consistent.
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from Proposal p where p.id = :id")
    Optional<Proposal> findForUpdate(@Param("id") UUID id);

    Page<Proposal> findByStatusOrderByCreatedAtDescIdDesc(ProposalStatus status, Pageable pageable);

    Page<Proposal> findByStatusAndTopicOrderByCreatedAtDescIdDesc(ProposalStatus status, ProposalTopic topic,
                                                                  Pageable pageable);

    // Moderation queue: oldest first.
    Page<Proposal> findByStatusOrderByCreatedAtAscIdAsc(ProposalStatus status, Pageable pageable);

    Page<Proposal> findByAuthorIdOrderByCreatedAtDescIdDesc(UUID authorId, Pageable pageable);
}
