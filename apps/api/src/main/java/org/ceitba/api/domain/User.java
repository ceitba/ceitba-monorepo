package org.ceitba.api.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.DynamicUpdate;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.OffsetDateTime;
import java.util.UUID;

// User is a hub of 12 wiki relations in the schema. Per MIGRATION.md §3,
// the inverse @OneToMany sides are NOT mapped here — fetch via the child
// repository instead. Only User ↔ CeitbaStaff (1:1) is bidirectional.
//
// @DynamicUpdate: an UPDATE writes only the columns that actually changed, so
// a profile/preferences save never rewrites columns it did not touch (e.g.
// a file_number set meanwhile by another request's conditional UPDATE, see
// UserRepository.setFileNumberIfNull, or by staff).
@Entity
@DynamicUpdate
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

    @Column(name = "preferred_language", length = 5)
    private String preferredLanguage;

    @Column(name = "theme", length = 8)
    private String theme;

    @Column(name = "google_sub", unique = true)
    private String googleSub;

    @Column(name = "avatar_url")
    private String avatarUrl;

    // Normalized social handles (see service/user/SocialHandles).
    @Column(name = "linkedin", length = 100)
    private String linkedin;

    @Column(name = "instagram", length = 30)
    private String instagram;

    @Column(name = "discord", length = 37)
    private String discord;

    // Firebase Auth uid for users imported from the legacy Firestore app (V26).
    @Column(name = "firebase_uid", length = 128, unique = true)
    private String firebaseUid;

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
    public String getPreferredLanguage() { return preferredLanguage; }
    public String getTheme() { return theme; }

    public void setFileNumber(Integer fileNumber) { this.fileNumber = fileNumber; }
    public void setCareer(Career career) { this.career = career; }
    public void setPlan(String plan) { this.plan = plan; }
    public void setName(String name) { this.name = name; }
    public void setPreferredLanguage(String preferredLanguage) { this.preferredLanguage = preferredLanguage; }
    public void setTheme(String theme) { this.theme = theme; }
    public void setGoogleSub(String googleSub) { this.googleSub = googleSub; }
    public void setAvatarUrl(String avatarUrl) { this.avatarUrl = avatarUrl; }

    public String getGoogleSub() { return googleSub; }
    public String getAvatarUrl() { return avatarUrl; }

    public String getLinkedin() { return linkedin; }
    public String getInstagram() { return instagram; }
    public String getDiscord() { return discord; }
    public void setLinkedin(String linkedin) { this.linkedin = linkedin; }
    public void setInstagram(String instagram) { this.instagram = instagram; }
    public void setDiscord(String discord) { this.discord = discord; }

    public String getFirebaseUid() { return firebaseUid; }
    public void setFirebaseUid(String firebaseUid) { this.firebaseUid = firebaseUid; }

}
