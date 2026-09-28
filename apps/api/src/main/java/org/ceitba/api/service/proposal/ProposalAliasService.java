package org.ceitba.api.service.proposal;

import org.ceitba.api.domain.proposal.ProposalAlias;
import org.ceitba.api.domain.proposal.ProposalAliasId;
import org.ceitba.api.repository.proposal.ProposalAliasRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

// Server-side pseudonyms: a user's alias on a proposal is created the first
// time they author or comment on it and never changes afterwards.
@Service
public class ProposalAliasService {

    private final ProposalAliasRepository aliases;
    private final ProposalAliasGenerator generator;

    public ProposalAliasService(ProposalAliasRepository aliases, ProposalAliasGenerator generator) {
        this.aliases = aliases;
        this.generator = generator;
    }

    // Caller must hold the proposal row lock (ProposalRepository.findForUpdate)
    // so two first-time commenters cannot pick the same alias.
    @Transactional(propagation = Propagation.MANDATORY)
    public String aliasFor(UUID proposalId, UUID userId) {
        return aliases.findById(new ProposalAliasId(proposalId, userId))
            .map(ProposalAlias::getAlias)
            .orElseGet(() -> {
                String alias = generator.next(aliases.findAliasesByProposalId(proposalId));
                aliases.save(new ProposalAlias(proposalId, userId, alias));
                return alias;
            });
    }
}
