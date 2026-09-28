package org.ceitba.api.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

// A student study group (V24). Plain id columns (owner_id, subject_id), no
// associations: the service batch-loads users and subjects for the page it
// renders. maxParticipants counts every member including the owner; null
// means unlimited. Capacity is enforced by StudyGroupService under a
// pessimistic lock on this row.
//
// Locations are stored as text[] of StudyGroupLocation names; the entity
// exposes them typed.
@Entity
@Table(schema = "public", name = "study_groups")
public class StudyGroup {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "owner_id", nullable = false)
    private UUID ownerId;

    @Column(nullable = false, length = 120)
    private String title;

    @Column(name = "subject_id", nullable = false, length = 25)
    private String subjectId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private StudyGroupType type;

    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(columnDefinition = "text[]", nullable = false)
    private List<String> locations = new ArrayList<>();

    @Column(name = "due_at", nullable = false)
    private OffsetDateTime dueAt;

    @Column(length = 2000)
    private String description;

    @Column(name = "contact_link", length = 2048)
    private String contactLink;

    @Column(name = "max_participants")
    private Integer maxParticipants;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    protected StudyGroup() {}

    public StudyGroup(UUID ownerId, String title, String subjectId, StudyGroupType type,
                      List<StudyGroupLocation> locations, OffsetDateTime dueAt) {
        this.ownerId = ownerId;
        this.title = title;
        this.subjectId = subjectId;
        this.type = type;
        setLocations(locations);
        this.dueAt = dueAt;
    }

    public UUID getId() { return id; }
    public UUID getOwnerId() { return ownerId; }
    public String getTitle() { return title; }
    public String getSubjectId() { return subjectId; }
    public StudyGroupType getType() { return type; }
    public List<StudyGroupLocation> getLocations() {
        return locations.stream().map(StudyGroupLocation::valueOf).toList();
    }
    public OffsetDateTime getDueAt() { return dueAt; }
    public String getDescription() { return description; }
    public String getContactLink() { return contactLink; }
    public Integer getMaxParticipants() { return maxParticipants; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
    public OffsetDateTime getUpdatedAt() { return updatedAt; }

    public boolean isOwnedBy(UUID userId) { return ownerId.equals(userId); }

    public boolean isPastDue(OffsetDateTime now) { return !dueAt.isAfter(now); }

    public void setOwnerId(UUID ownerId) { this.ownerId = ownerId; }
    public void setTitle(String title) { this.title = title; }
    public void setSubjectId(String subjectId) { this.subjectId = subjectId; }
    public void setType(StudyGroupType type) { this.type = type; }
    public void setLocations(List<StudyGroupLocation> locations) {
        this.locations = new ArrayList<>(
            locations == null ? List.of() : locations.stream().distinct().map(Enum::name).toList());
    }
    public void setDueAt(OffsetDateTime dueAt) { this.dueAt = dueAt; }
    public void setDescription(String description) { this.description = description; }
    public void setContactLink(String contactLink) { this.contactLink = contactLink; }
    public void setMaxParticipants(Integer maxParticipants) { this.maxParticipants = maxParticipants; }
}
