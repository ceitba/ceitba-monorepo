package org.ceitba.api.domain.orgmail;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import org.hibernate.annotations.CreationTimestamp;

import java.time.OffsetDateTime;
import java.util.UUID;

// A follower who doesn't want an organization's emails (V57).
@Entity
@Table(schema = "public", name = "org_mail_optouts")
@IdClass(OrgMailOptoutId.class)
public class OrgMailOptout {

    @Id
    @Column(name = "user_id")
    private UUID userId;

    @Id
    @Column(name = "org_slug")
    private String orgSlug;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    protected OrgMailOptout() {}

    public OrgMailOptout(UUID userId, String orgSlug) {
        this.userId = userId;
        this.orgSlug = orgSlug;
    }

    public UUID getUserId()   { return userId; }
    public String getOrgSlug() { return orgSlug; }
}
