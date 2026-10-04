package org.ceitba.api.repository.digest;

import org.ceitba.api.domain.digest.DigestIssueLink;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface DigestIssueLinkRepository extends JpaRepository<DigestIssueLink, DigestIssueLink.Key> {

    List<DigestIssueLink> findByIssueIdOrderByLinkIdAsc(UUID issueId);
}
