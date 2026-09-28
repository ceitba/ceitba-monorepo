package org.ceitba.api.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.OffsetDateTime;
import java.util.UUID;

// MODERATOR grant (V19). Plain id columns, no User association: the grant is
// looked up by user id on every request and never needs the User graph.
@Entity
@Table(schema = "public", name = "ceitba_moderators")
public class CeitbaModerator {

    @Id
    @Column(name = "user_id")
    private UUID userId;

    @Column(name = "granted_by")
    private UUID grantedBy;

    @Column(name = "granted_at", nullable = false)
    private OffsetDateTime grantedAt;

    @Column(name = "revoked_at")
    private OffsetDateTime revokedAt;

    @Column(name = "revoked_by")
    private UUID revokedBy;

    protected CeitbaModerator() {}

    public CeitbaModerator(UUID userId, UUID grantedBy, OffsetDateTime grantedAt) {
        this.userId = userId;
        this.grantedBy = grantedBy;
        this.grantedAt = grantedAt;
    }

    public boolean isActive() { return revokedAt == null; }

    // Re-grant after a revoke: the row becomes active again with new audit data.
    public void regrant(UUID by, OffsetDateTime at) {
        this.grantedBy = by;
        this.grantedAt = at;
        this.revokedAt = null;
        this.revokedBy = null;
    }

    public void revoke(UUID by, OffsetDateTime at) {
        this.revokedBy = by;
        this.revokedAt = at;
    }

    public UUID getUserId() { return userId; }
    public UUID getGrantedBy() { return grantedBy; }
    public OffsetDateTime getGrantedAt() { return grantedAt; }
    public OffsetDateTime getRevokedAt() { return revokedAt; }
    public UUID getRevokedBy() { return revokedBy; }
}
