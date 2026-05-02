package org.ceitba.api.repository;

import org.ceitba.api.domain.CeitbaStaff;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface CeitbaStaffRepository extends JpaRepository<CeitbaStaff, UUID> {
}
