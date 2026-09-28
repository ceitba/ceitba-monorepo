package org.ceitba.api.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

import java.time.OffsetDateTime;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

// Snapshot of the scheduler SPA's selection state. The payload is whatever
// the SPA cares about (selected commissions, scheduler options, blocked
// times) — opaque to the API. We persist it as JSONB so CRUD stays trivial;
// nothing ever queries inside the payload, only by user_id.
//
// The 5-per-user cap is enforced in the service, not at the schema level,
// so we can return a precise 409 with a code the SPA shows to the user.
//
// `primary` (V22) marks the schedule the mobile app shows on its home
// calendar. At most one per user, backed by a partial unique index.
@Entity
@Table(schema = "public", name = "saved_schedules")
public class SavedSchedule {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(nullable = false, length = 120)
    private String name;

    @Column(name = "career_id", length = 16)
    private String careerId;

    @Column(length = 255)
    private String plan;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb", nullable = false)
    private Map<String, Object> payload = new HashMap<>();

    @Column(name = "is_primary", nullable = false)
    private boolean primary;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    protected SavedSchedule() {}

    public SavedSchedule(UUID userId, String name, Map<String, Object> payload) {
        this.userId = userId;
        this.name = name;
        this.payload = payload != null ? payload : new HashMap<>();
    }

    public UUID getId() { return id; }
    public UUID getUserId() { return userId; }
    public String getName() { return name; }
    public String getCareerId() { return careerId; }
    public String getPlan() { return plan; }
    public Map<String, Object> getPayload() { return payload; }
    public boolean isPrimary() { return primary; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
    public OffsetDateTime getUpdatedAt() { return updatedAt; }

    public void setName(String name) { this.name = name; }
    public void setCareerId(String careerId) { this.careerId = careerId; }
    public void setPlan(String plan) { this.plan = plan; }
    public void setPrimary(boolean primary) { this.primary = primary; }
    public void setPayload(Map<String, Object> payload) {
        this.payload = payload != null ? payload : new HashMap<>();
    }
}
