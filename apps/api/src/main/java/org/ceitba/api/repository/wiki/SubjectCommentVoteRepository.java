package org.ceitba.api.repository.wiki;

import org.ceitba.api.domain.wiki.SubjectCommentVote;
import org.ceitba.api.domain.wiki.SubjectCommentVoteId;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SubjectCommentVoteRepository extends JpaRepository<SubjectCommentVote, SubjectCommentVoteId> {
}
