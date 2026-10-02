package org.ceitba.api.domain.news;

import jakarta.persistence.Column;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

import java.time.OffsetDateTime;

@Entity
@Table(schema = "public", name = "vote_records")
public class VoteRecord {

    @EmbeddedId
    private VoteRecordId id;

    @Column(name = "vote_type", nullable = false)
    private String voteType;

    @Column(name = "created_at", updatable = false)
    private OffsetDateTime createdAt = OffsetDateTime.now();

    protected VoteRecord() {}

    public VoteRecord(String articleId, String fingerprint, String voteType) {
        this.id       = new VoteRecordId(articleId, fingerprint);
        this.voteType = voteType;
    }

    // Re-keys a vote under a new fingerprint, keeping when it was cast.
    public VoteRecord(String articleId, String fingerprint, String voteType, OffsetDateTime createdAt) {
        this(articleId, fingerprint, voteType);
        if (createdAt != null) {
            this.createdAt = createdAt;
        }
    }

    public VoteRecordId getId()    { return id; }
    public String getVoteType()    { return voteType; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
}
