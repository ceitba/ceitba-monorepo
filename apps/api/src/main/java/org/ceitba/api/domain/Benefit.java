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

    @Column(name = "name_es")
    private String nameEs;

    @Column(name = "name_en")
    private String nameEn;

    // Stored as String[] (not List<String>) on purpose: Hibernate 6.5 caches the
    // BasicType it resolves for List<String>, so if Article (List<String> as
    // JSON) is bound first, this column gets typed as JSON and schema
    // validation fails at startup. String[] can't collide. See ListStringMappingOrderIT.
    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(name = "highlights_es", columnDefinition = "text[]", nullable = false)
    private String[] highlightsEs = new String[0];

    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(name = "highlights_en", columnDefinition = "text[]", nullable = false)
    private String[] highlightsEn = new String[0];

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
    public String getNameEs() { return nameEs; }
    public String getNameEn() { return nameEn; }
    public List<String> getHighlightsEs() { return StringArrays.toList(highlightsEs); }
    public List<String> getHighlightsEn() { return StringArrays.toList(highlightsEn); }
    public OffsetDateTime getCreatedAt() { return createdAt; }
    public OffsetDateTime getUpdatedAt() { return updatedAt; }

    public void setColorVar(String colorVar) { this.colorVar = colorVar; }
    public void setDisplayOrder(int displayOrder) { this.displayOrder = displayOrder; }
    public void setLinkUrl(String linkUrl) { this.linkUrl = linkUrl; }
    public void setContactEmail(String contactEmail) { this.contactEmail = contactEmail; }
    public void setNameEs(String nameEs) { this.nameEs = nameEs; }
    public void setNameEn(String nameEn) { this.nameEn = nameEn; }
    public void setHighlightsEs(List<String> highlightsEs) {
        this.highlightsEs = StringArrays.fromList(highlightsEs);
    }
    public void setHighlightsEn(List<String> highlightsEn) {
        this.highlightsEn = StringArrays.fromList(highlightsEn);
    }
}
