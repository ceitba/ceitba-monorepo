package org.ceitba.api.repository;

import org.ceitba.api.domain.Plan;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface PlanRepository extends JpaRepository<Plan, String> {

    List<Plan> findByCareer_Id(String careerId);
}
