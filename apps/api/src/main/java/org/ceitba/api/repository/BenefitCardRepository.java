package org.ceitba.api.repository;

import org.ceitba.api.domain.BenefitCard;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface BenefitCardRepository extends JpaRepository<BenefitCard, UUID> {
    List<BenefitCard> findAllByOrderByDisplayOrderAscTitleEsAsc();
}
