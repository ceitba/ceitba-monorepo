package org.ceitba.api.repository.correction;

import org.ceitba.api.domain.correction.ScheduleCorrection;
import org.ceitba.api.domain.correction.ScheduleCorrectionStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface ScheduleCorrectionRepository extends JpaRepository<ScheduleCorrection, UUID> {

    // The parent commission of a correction without loading the entity, so
    // the caller can lock the commission first and then read fresh state.
    @Query("select c.commissionId from ScheduleCorrection c where c.id = :id")
    Optional<String> findCommissionIdById(@Param("id") UUID id);

    List<ScheduleCorrection> findByCommissionIdInAndStatusIn(Collection<String> commissionIds,
                                                             Collection<ScheduleCorrectionStatus> statuses);

    List<ScheduleCorrection> findByCommissionIdAndStatusIn(String commissionId,
                                                           Collection<ScheduleCorrectionStatus> statuses);

    Optional<ScheduleCorrection> findFirstByCommissionIdAndSlotsKeyAndStatusIn(
        String commissionId, String slotsKey, Collection<ScheduleCorrectionStatus> statuses);

    boolean existsByCommissionIdAndSuggesterIdAndStatus(String commissionId, UUID suggesterId,
                                                        ScheduleCorrectionStatus status);

    List<ScheduleCorrection> findBySuggesterIdOrderByCreatedAtDescIdDesc(UUID suggesterId);

    Optional<ScheduleCorrection> findByIdAndSuggesterId(UUID id, UUID suggesterId);

    Page<ScheduleCorrection> findByStatusOrderByCreatedAtDescIdDesc(ScheduleCorrectionStatus status,
                                                                    Pageable pageable);

    Page<ScheduleCorrection> findAllByOrderByCreatedAtDescIdDesc(Pageable pageable);
}
