package org.ceitba.api.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.MapsId;
import jakarta.persistence.OneToOne;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.OffsetDateTime;
import java.util.UUID;

@Entity
@Table(schema = "public", name = "ceitba_staff")
public class CeitbaStaff {

    @Id
    @Column(name = "user_id")
    private UUID userId;

    @OneToOne(fetch = FetchType.LAZY, optional = false)
    @MapsId
    @JoinColumn(name = "user_id")
    private User user;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    @Column(nullable = false, columnDefinition = "ceitba_branch")
    private CeitbaBranch branch;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    @Column(nullable = false, columnDefinition = "ceitba_staff_role")
    private CeitbaStaffRole role = CeitbaStaffRole.MEMBER;

    @Column(name = "start", nullable = false)
    private OffsetDateTime start;

    @Column(name = "\"end\"", nullable = false)
    private OffsetDateTime end;

    protected CeitbaStaff() {}

    public CeitbaStaff(User user, CeitbaBranch branch, CeitbaStaffRole role,
                       OffsetDateTime start, OffsetDateTime end) {
        // @MapsId derives userId from user.id at flush time. Setting userId
        // explicitly here used to confuse Hibernate ("null identifier") because
        // @MapsId nulls the @Id field expecting to fill it from the relationship.
        this.user = user;
        this.branch = branch;
        this.role = role;
        this.start = start;
        this.end = end;
    }

    public UUID getUserId() { return userId; }
    public User getUser() { return user; }
    public CeitbaBranch getBranch() { return branch; }
    public CeitbaStaffRole getRole() { return role; }
    public OffsetDateTime getStart() { return start; }
    public OffsetDateTime getEnd() { return end; }
}
