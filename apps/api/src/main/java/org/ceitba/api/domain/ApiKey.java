package org.ceitba.api.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.CreationTimestamp;

import java.time.OffsetDateTime;
import java.util.UUID;

@Entity
@Table(name = "api_keys")
public class ApiKey {

    @Id
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(nullable = false)
    private String name;

    @Column(name = "key_hash", nullable = false, columnDefinition = "CHAR(64)")
    private String keyHash;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @Column(name = "expires_at", nullable = false)
    private OffsetDateTime expiresAt;

    @Column(name = "last_used_at")
    private OffsetDateTime lastUsedAt;

    protected ApiKey() {}

    public ApiKey(UUID id, UUID userId, String name, String keyHash, OffsetDateTime expiresAt) {
        this.id       = id;
        this.userId   = userId;
        this.name     = name;
        this.keyHash  = keyHash;
        this.expiresAt = expiresAt;
    }

    public UUID getId()                  { return id; }
    public UUID getUserId()              { return userId; }
    public String getName()              { return name; }
    public String getKeyHash()           { return keyHash; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
    public OffsetDateTime getExpiresAt() { return expiresAt; }
    public OffsetDateTime getLastUsedAt(){ return lastUsedAt; }

    public boolean isExpired() { return OffsetDateTime.now().isAfter(expiresAt); }

    public void markUsed() { this.lastUsedAt = OffsetDateTime.now(); }
}
