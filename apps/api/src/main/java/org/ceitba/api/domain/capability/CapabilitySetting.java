package org.ceitba.api.domain.capability;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.OffsetDateTime;
import java.util.UUID;

// Global switch for a capability (V39). No row = disabled for all.
@Entity
@Table(schema = "public", name = "capability_settings")
public class CapabilitySetting {

    @Id
    @Column(name = "capability")
    private String capability;

    @Column(name = "enabled_for_all", nullable = false)
    private boolean enabledForAll;

    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    @Column(name = "updated_by")
    private UUID updatedBy;

    protected CapabilitySetting() {}

    public CapabilitySetting(String capability) {
        this.capability = capability;
    }

    public void setEnabledForAll(boolean enabledForAll, UUID by, OffsetDateTime at) {
        this.enabledForAll = enabledForAll;
        this.updatedBy = by;
        this.updatedAt = at;
    }

    public String getCapability() { return capability; }
    public boolean isEnabledForAll() { return enabledForAll; }
    public OffsetDateTime getUpdatedAt() { return updatedAt; }
    public UUID getUpdatedBy() { return updatedBy; }
}
