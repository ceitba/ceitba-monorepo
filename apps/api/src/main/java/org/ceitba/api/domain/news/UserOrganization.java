package org.ceitba.api.domain.news;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import org.hibernate.annotations.CreationTimestamp;

import java.time.OffsetDateTime;
import java.util.UUID;

// Many-to-many membership of a User in an Organization. Per MIGRATION.md §3
// the inverse @OneToMany side on User is intentionally NOT mapped — fetch via
// UserOrganizationRepository instead.
@Entity
@Table(schema = "public", name = "user_organizations")
@IdClass(UserOrganizationId.class)
public class UserOrganization {

    @Id
    @Column(name = "user_id")
    private UUID userId;

    @Id
    @Column(name = "org_slug")
    private String organization;

    @Column(nullable = false)
    private String role;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    protected UserOrganization() {}

    public UserOrganization(UUID userId, String organization, String role) {
        this.userId = userId;
        this.organization = organization;
        this.role = role;
    }

    public UUID getUserId()             { return userId; }
    public String getOrganization()     { return organization; }
    public String getRole()             { return role; }
    public OffsetDateTime getCreatedAt(){ return createdAt; }

    public void setRole(String role)    { this.role = role; }
}
