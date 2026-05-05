package org.ceitba.api.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.OffsetDateTime;
import java.util.UUID;

// Public roster entry for the CeitbaPage staff section. Decoupled from
// ceitba_staff so we can list members who never log in (alumni, photo
// credits) without giving them ROLE_STAFF, and vice versa.
@Entity
@Table(schema = "public", name = "staff_members")
public class StaffMember {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(nullable = false)
    private int year;

    @Column(name = "department_slug", nullable = false, length = 64)
    private String departmentSlug;

    @Column(name = "display_order", nullable = false)
    private int displayOrder;

    @Column(nullable = false)
    private String name;

    @Column(name = "role_es", nullable = false)
    private String roleEs;

    @Column(name = "role_en", nullable = false)
    private String roleEn;

    @Column(name = "photo_url")
    private String photoUrl;

    @Column(name = "linkedin_url")
    private String linkedinUrl;

    @Column
    private String email;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    protected StaffMember() {}

    public StaffMember(int year, String departmentSlug, String name, String roleEs, String roleEn) {
        this.year = year;
        this.departmentSlug = departmentSlug;
        this.name = name;
        this.roleEs = roleEs;
        this.roleEn = roleEn;
    }

    public UUID getId() { return id; }
    public int getYear() { return year; }
    public String getDepartmentSlug() { return departmentSlug; }
    public int getDisplayOrder() { return displayOrder; }
    public String getName() { return name; }
    public String getRoleEs() { return roleEs; }
    public String getRoleEn() { return roleEn; }
    public String getPhotoUrl() { return photoUrl; }
    public String getLinkedinUrl() { return linkedinUrl; }
    public String getEmail() { return email; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
    public OffsetDateTime getUpdatedAt() { return updatedAt; }

    public void setYear(int year) { this.year = year; }
    public void setDepartmentSlug(String departmentSlug) { this.departmentSlug = departmentSlug; }
    public void setDisplayOrder(int displayOrder) { this.displayOrder = displayOrder; }
    public void setName(String name) { this.name = name; }
    public void setRoleEs(String roleEs) { this.roleEs = roleEs; }
    public void setRoleEn(String roleEn) { this.roleEn = roleEn; }
    public void setPhotoUrl(String photoUrl) { this.photoUrl = photoUrl; }
    public void setLinkedinUrl(String linkedinUrl) { this.linkedinUrl = linkedinUrl; }
    public void setEmail(String email) { this.email = email; }
}
