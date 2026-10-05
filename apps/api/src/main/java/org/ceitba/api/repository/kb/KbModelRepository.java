package org.ceitba.api.repository.kb;

import org.ceitba.api.domain.kb.KbModel;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface KbModelRepository extends JpaRepository<KbModel, String> {

    java.util.List<KbModel> findAllByOrderByIdAsc();

    long countByIdStartingWith(String prefix);
}
