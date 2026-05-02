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
@Table(schema = "wiki", name = "subject_comment_vote")
@IdClass(SubjectCommentVoteId.class)
public class SubjectCommentVote {

    @Id
    @Column(name = "comment_id")
    private UUID commentId;

    @Id
    @Column(name = "user_id")
    private UUID userId;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    @Column(nullable = false, columnDefinition = "vote_type")
    private VoteType type;

    protected SubjectCommentVote() {}

    public SubjectCommentVote(UUID commentId, UUID userId, VoteType type) {
        this.commentId = commentId;
        this.userId = userId;
        this.type = type;
    }

    public UUID getCommentId() { return commentId; }
    public UUID getUserId() { return userId; }
    public VoteType getType() { return type; }
}
