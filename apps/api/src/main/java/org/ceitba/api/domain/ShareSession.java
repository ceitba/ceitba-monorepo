package org.ceitba.api.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.OffsetDateTime;
import java.util.UUID;

// Group sharing room for the scheduler SPA. The creator builds it from one
// of their saved_schedules; others join by attaching theirs. The public
// viewer fetches everyone via the opaque token and merges into a heatmap.
@Entity
@Table(schema = "public", name = "share_sessions")
public class ShareSession {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(nullable = false, length = 32, unique = true)
    private String token;

    @Column(name = "creator_user_id", nullable = false)
    private UUID creatorUserId;

    @Column(length = 120)
    private String name;

    @Column(name = "expires_at")
    private OffsetDateTime expiresAt;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    protected ShareSession() {}

    public ShareSession(String token, UUID creatorUserId, String name) {
        this.token = token;
        this.creatorUserId = creatorUserId;
        this.name = name;
    }

    public UUID getId() { return id; }
    public String getToken() { return token; }
    public UUID getCreatorUserId() { return creatorUserId; }
    public String getName() { return name; }
    public OffsetDateTime getExpiresAt() { return expiresAt; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
    public OffsetDateTime getUpdatedAt() { return updatedAt; }

    public void setName(String name) { this.name = name; }
    public void setExpiresAt(OffsetDateTime expiresAt) { this.expiresAt = expiresAt; }
}
