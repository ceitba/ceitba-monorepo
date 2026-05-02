package org.ceitba.api.repository;

import org.ceitba.api.domain.Career;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CareerRepository extends JpaRepository<Career, String> {
}
