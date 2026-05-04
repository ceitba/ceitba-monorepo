package org.ceitba.api.domain.news;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import org.ceitba.api.domain.User;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;

@Entity
@Table(schema = "public", name = "articles")
public class Article {

    @Id
    private String id;

    @Column(nullable = false)
    private String title;

    @Column(nullable = false)
    private String excerpt;

    // Stored as JSONB array of paragraph strings.
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb", nullable = false)
    private List<String> body;

    @Column(nullable = false)
    private String category;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "organization")
    private Organization organization;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb", nullable = false)
    private List<String> authors;

    @Column(name = "published_at")
    private LocalDate publishedAt;

    @Column(name = "reading_time")
    private String readingTime;

    @Column(nullable = false)
    private boolean featured = false;

    @Column(name = "color_scheme")
    private String colorScheme = "blue";

    @Column(name = "cover_image")
    private String coverImage;

    @Column(nullable = false)
    private String status = "published";

    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt = OffsetDateTime.now();

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "created_by")
    private User createdBy;

    protected Article() {}

    public Article(String id, String title, String excerpt, List<String> body,
                   String category, List<String> authors) {
        this.id       = id;
        this.title    = title;
        this.excerpt  = excerpt;
        this.body     = body;
        this.category = category;
        this.authors  = authors;
    }

    public String getId()              { return id; }
    public String getTitle()           { return title; }
    public String getExcerpt()         { return excerpt; }
    public List<String> getBody()      { return body; }
    public String getCategory()        { return category; }
    public Organization getOrganization() { return organization; }
    public List<String> getAuthors()   { return authors; }
    public LocalDate getPublishedAt()  { return publishedAt; }
    public String getReadingTime()     { return readingTime; }
    public boolean isFeatured()        { return featured; }
    public String getColorScheme()     { return colorScheme; }
    public String getCoverImage()      { return coverImage; }
    public String getStatus()          { return status; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
    public OffsetDateTime getUpdatedAt() { return updatedAt; }
    public User getCreatedBy()         { return createdBy; }

    public void setTitle(String title)           { this.title = title; }
    public void setExcerpt(String excerpt)       { this.excerpt = excerpt; }
    public void setBody(List<String> body)       { this.body = body; }
    public void setCategory(String category)     { this.category = category; }
    public void setOrganization(Organization o)  { this.organization = o; }
    public void setAuthors(List<String> authors) { this.authors = authors; }
    public void setPublishedAt(LocalDate d)      { this.publishedAt = d; }
    public void setReadingTime(String rt)        { this.readingTime = rt; }
    public void setFeatured(boolean featured)    { this.featured = featured; }
    public void setColorScheme(String cs)        { this.colorScheme = cs; }
    public void setCoverImage(String ci)         { this.coverImage = ci; }
    public void setStatus(String status)         { this.status = status; }
    public void setCreatedBy(User createdBy)     { this.createdBy = createdBy; }
}
