package org.ceitba.api.repository.kb;

import org.ceitba.api.domain.kb.KbPageRevision;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface KbPageRevisionRepository extends JpaRepository<KbPageRevision, UUID> {

    List<KbPageRevision> findByPageIdOrderByRevisionAsc(UUID pageId);
}
