package org.ceitba.api.repository.wiki;

import org.ceitba.api.domain.wiki.CareerNoteVote;
import org.ceitba.api.domain.wiki.CareerNoteVoteId;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CareerNoteVoteRepository extends JpaRepository<CareerNoteVote, CareerNoteVoteId> {
}
