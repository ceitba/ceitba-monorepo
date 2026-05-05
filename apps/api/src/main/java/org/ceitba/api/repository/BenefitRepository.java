package org.ceitba.api.repository;

import org.ceitba.api.domain.Benefit;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface BenefitRepository extends JpaRepository<Benefit, String> {
    List<Benefit> findAllByOrderByDisplayOrderAsc();
}
