package org.ceitba.api.repository.proposal;

import org.ceitba.api.domain.proposal.ProposalComment;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface ProposalCommentRepository extends JpaRepository<ProposalComment, UUID> {

    // Top-level comments, newest first. A deleted comment is still listed (as
    // a tombstone) while it has live replies.
    @Query(value = """
        select c from ProposalComment c
        where c.proposalId = :proposalId and c.parentId is null
          and (c.deletedAt is null or exists (
                select 1 from ProposalComment r where r.parentId = c.id and r.deletedAt is null))
        order by c.createdAt desc, c.id desc
        """,
        countQuery = """
        select count(c) from ProposalComment c
        where c.proposalId = :proposalId and c.parentId is null
          and (c.deletedAt is null or exists (
                select 1 from ProposalComment r where r.parentId = c.id and r.deletedAt is null))
        """)
    Page<ProposalComment> findThreads(@Param("proposalId") UUID proposalId, Pageable pageable);

    List<ProposalComment> findByParentIdInAndDeletedAtIsNullOrderByCreatedAtAscIdAsc(Collection<UUID> parentIds);

    Optional<ProposalComment> findByIdAndProposalId(UUID id, UUID proposalId);
}
