package org.ceitba.api.domain.capability;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;

import java.io.Serializable;
import java.time.OffsetDateTime;
import java.util.Objects;
import java.util.UUID;

// A capability granted to every member of an organization (V39).
@Entity
@Table(schema = "public", name = "capability_org_grants")
@IdClass(CapabilityOrgGrant.Id.class)
public class CapabilityOrgGrant {

    @jakarta.persistence.Id
    @Column(name = "capability")
    private String capability;

    @jakarta.persistence.Id
    @Column(name = "org_slug")
    private String orgSlug;

    @Column(name = "granted_at", nullable = false)
    private OffsetDateTime grantedAt;

    @Column(name = "granted_by")
    private UUID grantedBy;

    protected CapabilityOrgGrant() {}

    public CapabilityOrgGrant(String capability, String orgSlug, UUID grantedBy, OffsetDateTime grantedAt) {
        this.capability = capability;
        this.orgSlug = orgSlug;
        this.grantedBy = grantedBy;
        this.grantedAt = grantedAt;
    }

    public String getCapability() { return capability; }
    public String getOrgSlug() { return orgSlug; }
    public OffsetDateTime getGrantedAt() { return grantedAt; }
    public UUID getGrantedBy() { return grantedBy; }

    public static class Id implements Serializable {
        private String capability;
        private String orgSlug;

        public Id() {}

        public Id(String capability, String orgSlug) {
            this.capability = capability;
            this.orgSlug = orgSlug;
        }

        @Override
        public boolean equals(Object o) {
            return o instanceof Id other
                && Objects.equals(capability, other.capability) && Objects.equals(orgSlug, other.orgSlug);
        }

        @Override
        public int hashCode() { return Objects.hash(capability, orgSlug); }
    }
}
