package org.ceitba.api.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.OffsetDateTime;

@Entity
@Table(schema = "public", name = "plan")
public class Plan {

    @Id
    @Column(length = 25)
    private String id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "career_id", nullable = false)
    private Career career;

    @Column
    private String name;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    protected Plan() {}

    public Plan(String id, Career career, String name) {
        this.id = id;
        this.career = career;
        this.name = name;
    }

    public String getId() { return id; }
    public Career getCareer() { return career; }
    public String getName() { return name; }
    public OffsetDateTime getUpdatedAt() { return updatedAt; }
}
