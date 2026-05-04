package org.ceitba.api.domain.news;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import org.hibernate.annotations.CreationTimestamp;

import java.time.OffsetDateTime;
import java.util.UUID;

// User → organization newsfeed subscription. Distinct from UserOrganization
// (which confers admin rights). Per MIGRATION.md §3 the inverse @OneToMany
// on User is intentionally NOT mapped — fetch via UserFollowRepository.
@Entity
@Table(schema = "public", name = "user_follows")
@IdClass(UserFollowId.class)
public class UserFollow {

    @Id
    @Column(name = "user_id")
    private UUID userId;

    @Id
    @Column(name = "org_slug")
    private String organization;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    protected UserFollow() {}

    public UserFollow(UUID userId, String organization) {
        this.userId = userId;
        this.organization = organization;
    }

    public UUID getUserId()              { return userId; }
    public String getOrganization()      { return organization; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
}
