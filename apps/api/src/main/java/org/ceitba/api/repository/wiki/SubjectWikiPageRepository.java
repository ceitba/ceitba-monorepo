package org.ceitba.api.repository.wiki;

import org.ceitba.api.domain.wiki.SubjectWikiPage;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SubjectWikiPageRepository extends JpaRepository<SubjectWikiPage, String> {
}
