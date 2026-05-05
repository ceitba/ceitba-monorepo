package org.ceitba.api.repository;

import org.ceitba.api.domain.SavedSchedule;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface SavedScheduleRepository extends JpaRepository<SavedSchedule, UUID> {

    List<SavedSchedule> findByUserIdOrderByUpdatedAtDesc(UUID userId);

    long countByUserId(UUID userId);

    Optional<SavedSchedule> findByIdAndUserId(UUID id, UUID userId);
}
