package org.ceitba.api.repository.kb;

import org.ceitba.api.domain.kb.KbLlmEndpoint;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface KbLlmEndpointRepository extends JpaRepository<KbLlmEndpoint, UUID> {

    Optional<KbLlmEndpoint> findByName(String name);

    boolean existsByName(String name);

    List<KbLlmEndpoint> findAllByOrderByNameAsc();
}
