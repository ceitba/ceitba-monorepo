package org.ceitba.api.domain.wiki;

import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;

public class SubjectCommentVoteId implements Serializable {

    private UUID commentId;
    private UUID userId;

    public SubjectCommentVoteId() {}

    public SubjectCommentVoteId(UUID commentId, UUID userId) {
        this.commentId = commentId;
        this.userId = userId;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof SubjectCommentVoteId other)) return false;
        return Objects.equals(commentId, other.commentId)
            && Objects.equals(userId, other.userId);
    }

    @Override
    public int hashCode() {
        return Objects.hash(commentId, userId);
    }
}
