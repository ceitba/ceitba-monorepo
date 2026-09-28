package org.ceitba.api.repository.proposal;

import org.ceitba.api.domain.proposal.ProposalAlias;
import org.ceitba.api.domain.proposal.ProposalAliasId;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Set;
import java.util.UUID;

public interface ProposalAliasRepository extends JpaRepository<ProposalAlias, ProposalAliasId> {

    @Query("select a.alias from ProposalAlias a where a.proposalId = :proposalId")
    Set<String> findAliasesByProposalId(@Param("proposalId") UUID proposalId);

    List<ProposalAlias> findByProposalIdAndUserIdIn(UUID proposalId, Collection<UUID> userIds);

    // The alias of each proposal's own author.
    @Query("""
        select a from ProposalAlias a, Proposal p
        where p.id = a.proposalId and a.userId = p.authorId and p.id in :ids
        """)
    List<ProposalAlias> findAuthorAliases(@Param("ids") Collection<UUID> proposalIds);
}
