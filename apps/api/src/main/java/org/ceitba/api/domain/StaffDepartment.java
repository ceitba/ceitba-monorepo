package org.ceitba.api.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.OffsetDateTime;

@Entity
@Table(schema = "public", name = "staff_departments")
public class StaffDepartment {

    @Id
    @Column(length = 64)
    private String slug;

    @Column(name = "color_var", nullable = false, length = 64)
    private String colorVar;

    @Column(name = "display_order", nullable = false)
    private int displayOrder;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    protected StaffDepartment() {}

    public StaffDepartment(String slug, String colorVar, int displayOrder) {
        this.slug = slug;
        this.colorVar = colorVar;
        this.displayOrder = displayOrder;
    }

    public String getSlug() { return slug; }
    public String getColorVar() { return colorVar; }
    public int getDisplayOrder() { return displayOrder; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
    public OffsetDateTime getUpdatedAt() { return updatedAt; }

    public void setColorVar(String colorVar) { this.colorVar = colorVar; }
    public void setDisplayOrder(int displayOrder) { this.displayOrder = displayOrder; }
}
