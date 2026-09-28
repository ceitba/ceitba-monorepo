package org.ceitba.api.repository;

import jakarta.persistence.LockModeType;
import org.ceitba.api.domain.StudyGroup;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.UUID;

public interface StudyGroupRepository
        extends JpaRepository<StudyGroup, UUID>, JpaSpecificationExecutor<StudyGroup> {

    // SELECT ... FOR UPDATE. Every membership change (join, leave, capacity
    // edit) takes this lock first, so concurrent joins serialize on the group
    // row and the capacity check can't be raced.
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select g from StudyGroup g where g.id = :id")
    Optional<StudyGroup> findByIdForUpdate(@Param("id") UUID id);
}
