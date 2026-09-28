package org.ceitba.api.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.CreationTimestamp;

import java.time.OffsetDateTime;
import java.util.UUID;

// One rotating refresh token (see V17__refresh_tokens.sql). Only the SHA-256
// hex digest of the raw token is stored.
@Entity
@Table(name = "refresh_tokens")
public class RefreshToken {

    @Id
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "family_id", nullable = false)
    private UUID familyId;

    @Column(name = "token_hash", nullable = false, length = 64)
    private String tokenHash;

    @Column(name = "device_name", length = 120)
    private String deviceName;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @Column(name = "expires_at", nullable = false)
    private OffsetDateTime expiresAt;

    @Column(name = "revoked_at")
    private OffsetDateTime revokedAt;

    @Column(name = "replaced_by")
    private UUID replacedBy;

    protected RefreshToken() {}

    public RefreshToken(UUID id, UUID userId, UUID familyId, String tokenHash,
                        String deviceName, OffsetDateTime expiresAt) {
        this.id         = id;
        this.userId     = userId;
        this.familyId   = familyId;
        this.tokenHash  = tokenHash;
        this.deviceName = deviceName;
        this.expiresAt  = expiresAt;
    }

    public UUID getId()                  { return id; }
    public UUID getUserId()              { return userId; }
    public UUID getFamilyId()            { return familyId; }
    public String getTokenHash()         { return tokenHash; }
    public String getDeviceName()        { return deviceName; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
    public OffsetDateTime getExpiresAt() { return expiresAt; }
    public OffsetDateTime getRevokedAt() { return revokedAt; }
    public UUID getReplacedBy()          { return replacedBy; }

    public boolean isRevoked() { return revokedAt != null; }

    public void rotateTo(UUID successorId, OffsetDateTime now) {
        this.revokedAt  = now;
        this.replacedBy = successorId;
    }

    // Grace-window retry: the successor this token was rotated to is being
    // replaced. revokedAt is kept so the window is not extended by retries.
    public void repointTo(UUID successorId) {
        this.replacedBy = successorId;
    }
}
