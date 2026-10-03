package org.ceitba.api.repository.kb;

import org.ceitba.api.domain.kb.KbEval;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface KbEvalRepository extends JpaRepository<KbEval, UUID> {

    java.util.List<KbEval> findBySetIdOrderByCreatedAtAsc(UUID setId);

    java.util.List<KbEval> findAllByOrderByCreatedAtDesc(org.springframework.data.domain.Pageable page);
}
