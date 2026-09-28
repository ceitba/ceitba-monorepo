package org.ceitba.api.repository.proposal;

import org.ceitba.api.domain.proposal.ProposalAttachment;
import org.ceitba.api.domain.proposal.ProposalAttachmentId;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

public interface ProposalAttachmentRepository extends JpaRepository<ProposalAttachment, ProposalAttachmentId> {

    List<ProposalAttachment> findByProposalIdInOrderByPositionAsc(Collection<UUID> proposalIds);

    boolean existsByObjectKeyIn(Collection<String> objectKeys);
}
