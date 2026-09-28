package org.ceitba.api.repository;

import org.ceitba.api.domain.StudyGroupParticipant;
import org.ceitba.api.domain.StudyGroupParticipantId;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

public interface StudyGroupParticipantRepository
        extends JpaRepository<StudyGroupParticipant, StudyGroupParticipantId> {

    long countByGroupId(UUID groupId);

    boolean existsByGroupIdAndUserId(UUID groupId, UUID userId);

    // Join order, user id as a stable tie-break.
    List<StudyGroupParticipant> findByGroupIdOrderByJoinedAtAscUserIdAsc(UUID groupId);

    // [groupId, count] rows for the groups on a list page.
    @Query("select p.groupId, count(p) from StudyGroupParticipant p "
         + "where p.groupId in :groupIds group by p.groupId")
    List<Object[]> countByGroupIds(@Param("groupIds") Collection<UUID> groupIds);

    // Which of `groupIds` the user belongs to.
    @Query("select p.groupId from StudyGroupParticipant p "
         + "where p.userId = :userId and p.groupId in :groupIds")
    List<UUID> findJoinedGroupIds(@Param("userId") UUID userId,
                                  @Param("groupIds") Collection<UUID> groupIds);
}
