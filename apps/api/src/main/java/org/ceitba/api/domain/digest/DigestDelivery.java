package org.ceitba.api.domain.digest;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.PostLoad;
import jakarta.persistence.PostPersist;
import jakarta.persistence.Table;
import jakarta.persistence.Transient;
import org.springframework.data.domain.Persistable;

import java.time.OffsetDateTime;
import java.util.UUID;

// One recipient of an issue, snapshotted when sending starts. Status moves
// pending -> sending (claimed, committed before the SMTP call) -> sent | failed
// (DigestDeliveryRepository). Persistable so saveAll of the snapshot inserts
// straight away instead of paying a SELECT per recipient (the id is assigned).
@Entity
@Table(schema = "public", name = "digest_deliveries")
@IdClass(DigestDeliveryId.class)
public class DigestDelivery implements Persistable<DigestDeliveryId> {

    public static final String PENDING = "pending";
    public static final String SENDING = "sending";
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

    // Open/click tracking (docs/WEEKLY-DIGEST.md): random opaque id set right
    // before sending (kept across retries), and unflagged-event aggregates.
    @Column(name = "tracking_id")
    private String trackingId;

    @Column(name = "first_opened_at")
    private OffsetDateTime firstOpenedAt;

    @Column(name = "last_opened_at")
    private OffsetDateTime lastOpenedAt;

    @Column(name = "open_count", nullable = false)
    private int openCount;

    @Column(name = "first_clicked_at")
    private OffsetDateTime firstClickedAt;

    @Column(name = "click_count", nullable = false)
    private int clickCount;

    // When the row was claimed for sending (the last attempt's start).
    @Column(name = "claimed_at")
    private OffsetDateTime claimedAt;

    // TRANSIENT (recipient-scoped, temporary) failures so far.
    @Column(nullable = false)
    private int attempts;

    @Column(name = "last_error")
    private String lastError;

    @Transient
    private boolean isNew;

    protected DigestDelivery() {}

    public DigestDelivery(UUID issueId, UUID userId, String email) {
        this.issueId = issueId;
        this.userId = userId;
        this.email = email;
        this.isNew = true;
    }

    @Override
    public DigestDeliveryId getId() { return new DigestDeliveryId(issueId, userId); }

    @Override
    public boolean isNew() { return isNew; }

    @PostLoad
    @PostPersist
    void markNotNew() { this.isNew = false; }

    public UUID getIssueId() { return issueId; }
    public UUID getUserId() { return userId; }
    public String getEmail() { return email; }
    public String getStatus() { return status; }
    public String getError() { return error; }
    public OffsetDateTime getSentAt() { return sentAt; }
    public String getTrackingId() { return trackingId; }
    public OffsetDateTime getFirstOpenedAt() { return firstOpenedAt; }
    public OffsetDateTime getLastOpenedAt() { return lastOpenedAt; }
    public int getOpenCount() { return openCount; }
    public OffsetDateTime getFirstClickedAt() { return firstClickedAt; }
    public int getClickCount() { return clickCount; }
    public OffsetDateTime getClaimedAt() { return claimedAt; }
    public int getAttempts() { return attempts; }
    public String getLastError() { return lastError; }
}
