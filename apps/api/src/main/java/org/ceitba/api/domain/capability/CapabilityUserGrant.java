package org.ceitba.api.domain.capability;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;

import java.io.Serializable;
import java.time.OffsetDateTime;
import java.util.Objects;
import java.util.UUID;

// A capability granted to a (lowercased) email (V39). Keyed by email, not
// user id, so people who never logged in can be pre-granted.
@Entity
@Table(schema = "public", name = "capability_user_grants")
@IdClass(CapabilityUserGrant.Id.class)
public class CapabilityUserGrant {

    @jakarta.persistence.Id
    @Column(name = "capability")
    private String capability;

    @jakarta.persistence.Id
    @Column(name = "email")
    private String email;

    @Column(name = "granted_at", nullable = false)
    private OffsetDateTime grantedAt;

    @Column(name = "granted_by")
    private UUID grantedBy;

    protected CapabilityUserGrant() {}

    public CapabilityUserGrant(String capability, String email, UUID grantedBy, OffsetDateTime grantedAt) {
        this.capability = capability;
        this.email = email;
        this.grantedBy = grantedBy;
        this.grantedAt = grantedAt;
    }

    public String getCapability() { return capability; }
    public String getEmail() { return email; }
    public OffsetDateTime getGrantedAt() { return grantedAt; }
    public UUID getGrantedBy() { return grantedBy; }

    public static class Id implements Serializable {
        private String capability;
        private String email;

        public Id() {}

        public Id(String capability, String email) {
            this.capability = capability;
            this.email = email;
        }

        @Override
        public boolean equals(Object o) {
            return o instanceof Id other
                && Objects.equals(capability, other.capability) && Objects.equals(email, other.email);
        }

        @Override
        public int hashCode() { return Objects.hash(capability, email); }
    }
}
