package org.ceitba.api.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

// Individual benefit shown on the CeitbaPage benefits section. Rolls up
// under a `Benefit` row (used as a category — "sports", "discounts", ...).
@Entity
@Table(schema = "public", name = "benefit_cards")
public class BenefitCard {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "category_slug", nullable = false, length = 64)
    private String categorySlug;

    @Column(name = "display_order", nullable = false)
    private int displayOrder;

    @Column(name = "title_es", nullable = false)
    private String titleEs;

    @Column(name = "title_en", nullable = false)
    private String titleEn;

    @Column(name = "summary_es", nullable = false, columnDefinition = "text")
    private String summaryEs = "";

    @Column(name = "summary_en", nullable = false, columnDefinition = "text")
    private String summaryEn = "";

    @Column(name = "image_url")
    private String imageUrl;

    @Column(name = "cta_url")
    private String ctaUrl;

    @Column(name = "cta_label_es")
    private String ctaLabelEs;

    @Column(name = "cta_label_en")
    private String ctaLabelEn;

    @Column(name = "price")
    private String price;

    @Column(name = "location", columnDefinition = "text")
    private String location;

    @Column(name = "location_url", columnDefinition = "text")
    private String locationUrl;

    @Column(name = "phone", length = 64)
    private String phone;

    @Column(name = "website", columnDefinition = "text")
    private String website;

    @Column(name = "email")
    private String email;

    // Stored as String[] (not List<String>) on purpose: Hibernate 6.5 caches the
    // BasicType it resolves for List<String>, so if Article (List<String> as
    // JSON) is bound first, this column gets typed as JSON and schema
    // validation fails at startup. String[] can't collide. See ListStringMappingOrderIT.
    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(name = "bullets_es", columnDefinition = "text[]", nullable = false)
    private String[] bulletsEs = new String[0];

    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(name = "bullets_en", columnDefinition = "text[]", nullable = false)
    private String[] bulletsEn = new String[0];

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    protected BenefitCard() {}

    public BenefitCard(String categorySlug, String titleEs, String titleEn) {
        this.categorySlug = categorySlug;
        this.titleEs = titleEs;
        this.titleEn = titleEn;
    }

    public UUID getId() { return id; }
    public String getCategorySlug() { return categorySlug; }
    public int getDisplayOrder() { return displayOrder; }
    public String getTitleEs() { return titleEs; }
    public String getTitleEn() { return titleEn; }
    public String getSummaryEs() { return summaryEs; }
    public String getSummaryEn() { return summaryEn; }
    public String getImageUrl() { return imageUrl; }
    public String getCtaUrl() { return ctaUrl; }
    public String getCtaLabelEs() { return ctaLabelEs; }
    public String getCtaLabelEn() { return ctaLabelEn; }
    public String getPrice() { return price; }
    public String getLocation() { return location; }
    public String getLocationUrl() { return locationUrl; }
    public String getPhone() { return phone; }
    public String getWebsite() { return website; }
    public String getEmail() { return email; }
    public List<String> getBulletsEs() { return StringArrays.toList(bulletsEs); }
    public List<String> getBulletsEn() { return StringArrays.toList(bulletsEn); }
    public OffsetDateTime getCreatedAt() { return createdAt; }
    public OffsetDateTime getUpdatedAt() { return updatedAt; }

    public void setCategorySlug(String categorySlug) { this.categorySlug = categorySlug; }
    public void setDisplayOrder(int displayOrder) { this.displayOrder = displayOrder; }
    public void setTitleEs(String titleEs) { this.titleEs = titleEs; }
    public void setTitleEn(String titleEn) { this.titleEn = titleEn; }
    public void setSummaryEs(String summaryEs) { this.summaryEs = summaryEs != null ? summaryEs : ""; }
    public void setSummaryEn(String summaryEn) { this.summaryEn = summaryEn != null ? summaryEn : ""; }
    public void setImageUrl(String imageUrl) { this.imageUrl = imageUrl; }
    public void setCtaUrl(String ctaUrl) { this.ctaUrl = ctaUrl; }
    public void setCtaLabelEs(String ctaLabelEs) { this.ctaLabelEs = ctaLabelEs; }
    public void setCtaLabelEn(String ctaLabelEn) { this.ctaLabelEn = ctaLabelEn; }
    public void setPrice(String price) { this.price = price; }
    public void setLocation(String location) { this.location = location; }
    public void setLocationUrl(String locationUrl) { this.locationUrl = locationUrl; }
    public void setPhone(String phone) { this.phone = phone; }
    public void setWebsite(String website) { this.website = website; }
    public void setEmail(String email) { this.email = email; }
    public void setBulletsEs(List<String> bulletsEs) {
        this.bulletsEs = StringArrays.fromList(bulletsEs);
    }
    public void setBulletsEn(List<String> bulletsEn) {
        this.bulletsEn = StringArrays.fromList(bulletsEn);
    }
}
