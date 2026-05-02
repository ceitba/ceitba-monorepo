package org.ceitba.api.domain.wiki;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.OffsetDateTime;
import java.util.UUID;

@Entity
@Table(schema = "wiki", name = "career_note")
public class CareerNote {

    @Id
    private UUID id;

    @Column(name = "career_id", nullable = false, length = 25)
    private String careerId;

    @Column(nullable = false)
    private String name;

    @Column(name = "owner_name", nullable = false)
    private String ownerName;

    @Column(nullable = false, length = 1024)
    private String link;

    @Column(name = "uploader_id", nullable = false)
    private UUID uploaderId;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    protected CareerNote() {}

    public CareerNote(UUID id, String careerId, String name, String ownerName,
                      String link, UUID uploaderId) {
        this.id = id;
        this.careerId = careerId;
        this.name = name;
        this.ownerName = ownerName;
        this.link = link;
        this.uploaderId = uploaderId;
    }

    public UUID getId() { return id; }
    public String getCareerId() { return careerId; }
    public String getName() { return name; }
    public String getOwnerName() { return ownerName; }
    public String getLink() { return link; }
    public UUID getUploaderId() { return uploaderId; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
    public OffsetDateTime getUpdatedAt() { return updatedAt; }
}
