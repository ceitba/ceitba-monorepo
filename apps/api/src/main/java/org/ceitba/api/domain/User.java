package org.ceitba.api.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.OffsetDateTime;
import java.util.UUID;

// User is a hub of 12 wiki relations in the schema. Per MIGRATION.md §3,
// the inverse @OneToMany sides are NOT mapped here — fetch via the child
// repository instead. Only User ↔ CeitbaStaff (1:1) is bidirectional.
@Entity
@Table(schema = "public", name = "\"user\"")
public class User {

    @Id
    private UUID id;

    @Column(nullable = false, unique = true)
    private String email;

    @Column(name = "file_number", unique = true)
    private Integer fileNumber;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "career_id")
    private Career career;

    @Column(length = 255)
    private String plan;

    @Column
    private String name;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    @Column(name = "prefered_language", length = 5)
    private String preferedLanguage;

    @Column(name = "google_sub", unique = true)
    private String googleSub;

    @Column(name = "avatar_url")
    private String avatarUrl;

    protected User() {}

    public User(UUID id, String email, String name) {
        this.id = id;
        this.email = email;
        this.name = name;
    }

    public UUID getId() { return id; }
    public String getEmail() { return email; }
    public Integer getFileNumber() { return fileNumber; }
    public Career getCareer() { return career; }
    public String getPlan() { return plan; }
    public String getName() { return name; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
    public OffsetDateTime getUpdatedAt() { return updatedAt; }
    public String getPreferedLanguage() { return preferedLanguage; }

    public void setFileNumber(Integer fileNumber) { this.fileNumber = fileNumber; }
    public void setCareer(Career career) { this.career = career; }
    public void setPlan(String plan) { this.plan = plan; }
    public void setName(String name) { this.name = name; }
    public void setPreferedLanguage(String preferedLanguage) { this.preferedLanguage = preferedLanguage; }
    public void setGoogleSub(String googleSub) { this.googleSub = googleSub; }
    public void setAvatarUrl(String avatarUrl) { this.avatarUrl = avatarUrl; }

    public String getGoogleSub() { return googleSub; }
    public String getAvatarUrl() { return avatarUrl; }
}
