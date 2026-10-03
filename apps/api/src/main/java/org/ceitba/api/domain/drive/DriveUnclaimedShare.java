package org.ceitba.api.domain.drive;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.OffsetDateTime;

// A folder shared with the bot that no live source registers.
@Entity
@Table(schema = "wiki", name = "drive_unclaimed_share")
public class DriveUnclaimedShare {

    @Id
    @Column(name = "drive_id", length = 128)
    private String driveId;

    @Column(nullable = false, columnDefinition = "text")
    private String name;

    @Column(name = "owner_email", length = 320)
    private String ownerEmail;

    @Column(name = "first_seen_at", nullable = false)
    private OffsetDateTime firstSeenAt;

    @Column(name = "last_seen_at", nullable = false)
    private OffsetDateTime lastSeenAt;

    protected DriveUnclaimedShare() {}

    public DriveUnclaimedShare(String driveId, String name, String ownerEmail, OffsetDateTime now) {
        this.driveId = driveId;
        this.name = name;
        this.ownerEmail = ownerEmail;
        this.firstSeenAt = now;
        this.lastSeenAt = now;
    }

    public void seen(String name, String ownerEmail, OffsetDateTime now) {
        this.name = name;
        this.ownerEmail = ownerEmail;
        this.lastSeenAt = now;
    }

    public String getDriveId() { return driveId; }
    public String getName() { return name; }
    public String getOwnerEmail() { return ownerEmail; }
    public OffsetDateTime getFirstSeenAt() { return firstSeenAt; }
    public OffsetDateTime getLastSeenAt() { return lastSeenAt; }
}
