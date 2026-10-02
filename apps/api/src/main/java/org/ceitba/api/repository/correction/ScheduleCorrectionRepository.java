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

    // Account deletion: the commissions whose corrections the user voted on,
    // in a fixed order so the caller locks them without deadlocking.
    @Query("""
        select distinct c.commissionId from ScheduleCorrection c
        where c.id in (select v.correctionId from ScheduleCorrectionVote v where v.userId = :userId)
        order by c.commissionId
        """)
    List<String> findCommissionIdsVotedOnBy(@Param("userId") UUID userId);

    @Query("""
        select c from ScheduleCorrection c
        where c.commissionId = :commissionId
          and c.id in (select v.correctionId from ScheduleCorrectionVote v where v.userId = :userId)
        """)
    List<ScheduleCorrection> findByCommissionIdVotedOnBy(@Param("commissionId") String commissionId,
                                                        @Param("userId") UUID userId);

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
