package org.ceitba.api.repository.wiki;

import org.ceitba.api.domain.wiki.SubjectWikiEditProposal;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface SubjectWikiEditProposalRepository extends JpaRepository<SubjectWikiEditProposal, UUID> {

    List<SubjectWikiEditProposal> findBySubjectId(String subjectId);

    List<SubjectWikiEditProposal> findByProposedBy(UUID proposedBy);
}
