package org.ceitba.api.domain.wiki;

import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;

public class CareerNoteVoteId implements Serializable {

    private UUID noteId;
    private UUID userId;

    public CareerNoteVoteId() {}

    public CareerNoteVoteId(UUID noteId, UUID userId) {
        this.noteId = noteId;
        this.userId = userId;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof CareerNoteVoteId other)) return false;
        return Objects.equals(noteId, other.noteId)
            && Objects.equals(userId, other.userId);
    }

    @Override
    public int hashCode() {
        return Objects.hash(noteId, userId);
    }
}
