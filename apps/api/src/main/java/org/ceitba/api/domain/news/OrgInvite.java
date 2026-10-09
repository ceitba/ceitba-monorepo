package org.ceitba.api.domain.news;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import org.hibernate.annotations.CreationTimestamp;

import java.time.OffsetDateTime;
import java.util.UUID;

// An org admin's invite for an email that has not signed in yet (V54). It is
// claimed, i.e. turned into a UserOrganization, when that email is first
// provisioned (OrganizationMembershipService.claimInvites).
@Entity
@Table(schema = "public", name = "org_invites")
@IdClass(OrgInviteId.class)
public class OrgInvite {

    @Id
    @Column(name = "org_slug")
    private String organization;

    // Always lowercased (CHECK in V54).
    @Id
    @Column
    private String email;

    @Column(nullable = false)
    private String role;

    @Column(name = "invited_by")
    private UUID invitedBy;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    protected OrgInvite() {}

    public String getOrganization()      { return organization; }
    public String getEmail()             { return email; }
    public String getRole()              { return role; }
    public UUID getInvitedBy()           { return invitedBy; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
}
