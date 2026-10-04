package org.ceitba.api.domain.digest;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;

import java.time.OffsetDateTime;
import java.util.UUID;

// One recipient of an issue, snapshotted when sending starts. Status moves
// pending -> sent | failed in its own transaction (DigestDeliveryRepository).
@Entity
@Table(schema = "public", name = "digest_deliveries")
@IdClass(DigestDeliveryId.class)
public class DigestDelivery {

    public static final String PENDING = "pending";
    public static final String SENT = "sent";
    public static final String FAILED = "failed";

    @Id
    @Column(name = "issue_id")
    private UUID issueId;

    @Id
    @Column(name = "user_id")
    private UUID userId;

    @Column(nullable = false)
    private String email;

    @Column(nullable = false)
    private String status = PENDING;

    @Column
    private String error;

    // Time of the (last) attempt, for failed rows too.
    @Column(name = "sent_at")
    private OffsetDateTime sentAt;

    protected DigestDelivery() {}

    public DigestDelivery(UUID issueId, UUID userId, String email) {
        this.issueId = issueId;
        this.userId = userId;
        this.email = email;
    }

    public UUID getIssueId() { return issueId; }
    public UUID getUserId() { return userId; }
    public String getEmail() { return email; }
    public String getStatus() { return status; }
    public String getError() { return error; }
    public OffsetDateTime getSentAt() { return sentAt; }
}
