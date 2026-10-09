package org.ceitba.api.domain.orgmail;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;

import java.time.OffsetDateTime;
import java.util.UUID;

// One recipient of an announcement (V58): pending -> sending (claimed) ->
// sent | failed, like digest_deliveries (OrgAnnouncementSender).
@Entity
@Table(schema = "public", name = "org_announcement_deliveries")
@IdClass(OrgAnnouncementDeliveryId.class)
public class OrgAnnouncementDelivery {

    public static final String PENDING = "pending";
    public static final String SENDING = "sending";
    public static final String SENT = "sent";
    public static final String FAILED = "failed";

    @Id
    @Column(name = "announcement_id")
    private Long announcementId;

    @Id
    @Column(name = "user_id")
    private UUID userId;

    @Column(nullable = false)
    private String email;

    @Column(nullable = false)
    private String status = PENDING;

    @Column(nullable = false)
    private int attempts;

    @Column(name = "last_error")
    private String lastError;

    @Column(name = "claimed_at")
    private OffsetDateTime claimedAt;

    @Column(name = "sent_at")
    private OffsetDateTime sentAt;

    protected OrgAnnouncementDelivery() {}

    public OrgAnnouncementDelivery(Long announcementId, UUID userId, String email) {
        this.announcementId = announcementId;
        this.userId = userId;
        this.email = email;
    }

    public Long getAnnouncementId() { return announcementId; }
    public UUID getUserId()         { return userId; }
    public String getEmail()        { return email; }
    public String getStatus()       { return status; }
    public int getAttempts()        { return attempts; }
}
