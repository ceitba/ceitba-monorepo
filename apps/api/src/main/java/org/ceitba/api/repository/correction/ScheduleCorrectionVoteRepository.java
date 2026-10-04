package org.ceitba.api.repository.correction;

import org.ceitba.api.domain.correction.ScheduleCorrectionVote;
import org.ceitba.api.domain.correction.ScheduleCorrectionVoteId;
import org.ceitba.api.domain.correction.ScheduleCorrectionVoteType;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

public interface ScheduleCorrectionVoteRepository
        extends JpaRepository<ScheduleCorrectionVote, ScheduleCorrectionVoteId> {

    long countByCorrectionIdAndType(UUID correctionId, ScheduleCorrectionVoteType type);

    List<ScheduleCorrectionVote> findByUserIdAndCorrectionIdIn(UUID userId, Collection<UUID> correctionIds);

    // The votes of many users on many corrections (weekly digest prompts).
    List<ScheduleCorrectionVote> findByUserIdInAndCorrectionIdIn(Collection<UUID> userIds,
                                                                 Collection<UUID> correctionIds);
}
