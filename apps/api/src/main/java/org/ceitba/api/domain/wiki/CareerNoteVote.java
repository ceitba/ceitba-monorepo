package org.ceitba.api.domain.wiki;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import org.ceitba.api.domain.VoteType;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.util.UUID;

@Entity
@Table(schema = "wiki", name = "career_note_vote")
@IdClass(CareerNoteVoteId.class)
public class CareerNoteVote {

    @Id
    @Column(name = "note_id")
    private UUID noteId;

    @Id
    @Column(name = "user_id")
    private UUID userId;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    @Column(nullable = false, columnDefinition = "vote_type")
    private VoteType type;

    protected CareerNoteVote() {}

    public CareerNoteVote(UUID noteId, UUID userId, VoteType type) {
        this.noteId = noteId;
        this.userId = userId;
        this.type = type;
    }

    public UUID getNoteId() { return noteId; }
    public UUID getUserId() { return userId; }
    public VoteType getType() { return type; }
}
