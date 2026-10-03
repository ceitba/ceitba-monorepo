package org.ceitba.api.repository.kb;

import org.ceitba.api.domain.kb.KbEvalSet;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface KbEvalSetRepository extends JpaRepository<KbEvalSet, UUID> {

    java.util.Optional<KbEvalSet> findByName(String name);

    java.util.List<KbEvalSet> findAllByOrderByCreatedAtAsc();
}
