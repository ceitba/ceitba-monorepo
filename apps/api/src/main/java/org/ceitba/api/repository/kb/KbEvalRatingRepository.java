package org.ceitba.api.repository.kb;

import org.ceitba.api.domain.kb.KbEvalRating;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

public interface KbEvalRatingRepository extends JpaRepository<KbEvalRating, UUID> {

    List<KbEvalRating> findByEvalId(UUID evalId);

    List<KbEvalRating> findByEvalIdIn(Collection<UUID> evalIds);

    List<KbEvalRating> findByEvalIdAndReviewerIdAndSubjectIdAndSlugOrderByAssignedAtDesc(UUID evalId, UUID reviewerId,
                                                                                        String subjectId, String slug);
}
