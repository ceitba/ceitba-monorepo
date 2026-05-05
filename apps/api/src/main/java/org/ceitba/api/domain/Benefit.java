package org.ceitba.api.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;

@Entity
@Table(schema = "public", name = "benefits")
public class Benefit {

    @Id
    @Column(length = 64)
    private String slug;

    @Column(name = "color_var", nullable = false, length = 64)
    private String colorVar;

    @Column(name = "display_order", nullable = false)
    private int displayOrder;

    @Column(name = "link_url")
    private String linkUrl;

    @Column(name = "contact_email")
    private String contactEmail;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "highlights_es", columnDefinition = "jsonb", nullable = false)
    private List<String> highlightsEs = new ArrayList<>();

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "highlights_en", columnDefinition = "jsonb", nullable = false)
    private List<String> highlightsEn = new ArrayList<>();

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    protected Benefit() {}

    public Benefit(String slug, String colorVar, int displayOrder) {
        this.slug = slug;
        this.colorVar = colorVar;
        this.displayOrder = displayOrder;
    }

    public String getSlug() { return slug; }
    public String getColorVar() { return colorVar; }
    public int getDisplayOrder() { return displayOrder; }
    public String getLinkUrl() { return linkUrl; }
    public String getContactEmail() { return contactEmail; }
    public List<String> getHighlightsEs() { return highlightsEs; }
    public List<String> getHighlightsEn() { return highlightsEn; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
    public OffsetDateTime getUpdatedAt() { return updatedAt; }

    public void setColorVar(String colorVar) { this.colorVar = colorVar; }
    public void setDisplayOrder(int displayOrder) { this.displayOrder = displayOrder; }
    public void setLinkUrl(String linkUrl) { this.linkUrl = linkUrl; }
    public void setContactEmail(String contactEmail) { this.contactEmail = contactEmail; }
    public void setHighlightsEs(List<String> highlightsEs) {
        this.highlightsEs = highlightsEs != null ? highlightsEs : new ArrayList<>();
    }
    public void setHighlightsEn(List<String> highlightsEn) {
        this.highlightsEn = highlightsEn != null ? highlightsEn : new ArrayList<>();
    }
}
