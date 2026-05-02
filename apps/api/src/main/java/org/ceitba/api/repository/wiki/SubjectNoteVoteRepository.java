package org.ceitba.api.repository.wiki;

import org.ceitba.api.domain.wiki.SubjectNoteVote;
import org.ceitba.api.domain.wiki.SubjectNoteVoteId;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SubjectNoteVoteRepository extends JpaRepository<SubjectNoteVote, SubjectNoteVoteId> {
}
