package org.ceitba.api.domain.news;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(schema = "public", name = "organizations")
public class Organization {

    @Id
    private String slug;

    @Column(nullable = false)
    private String name;

    @Column(name = "full_name", nullable = false)
    private String fullName;

    @Column
    private String description;

    @Column
    private String category;

    @Column
    private String color;

    @Column(name = "logo_url")
    private String logoUrl;

    @Column(name = "background_url")
    private String backgroundUrl;

    @Column
    private String instagram;

    @Column(name = "linkedin_url")
    private String linkedinUrl;

    @Column(name = "website_url")
    private String websiteUrl;

    @Column(name = "contact_email")
    private String contactEmail;

    @Column(name = "recruiting_open", nullable = false)
    private boolean recruitingOpen;

    @Column(name = "recruiting_url")
    private String recruitingUrl;

    @Column(name = "recruiting_text")
    private String recruitingText;

    protected Organization() {}

    public Organization(String slug, String name, String fullName) {
        this.slug = slug;
        this.name = name;
        this.fullName = fullName;
    }

    public String getSlug()        { return slug; }
    public String getName()        { return name; }
    public String getFullName()    { return fullName; }
    public String getDescription() { return description; }
    public String getCategory()    { return category; }
    public String getColor()       { return color; }
    public String getLogoUrl()       { return logoUrl; }
    public String getBackgroundUrl() { return backgroundUrl; }
    public String getInstagram()     { return instagram; }
    public String getLinkedinUrl()   { return linkedinUrl; }
    public String getWebsiteUrl()    { return websiteUrl; }
    public String getContactEmail()  { return contactEmail; }
    public boolean isRecruitingOpen(){ return recruitingOpen; }
    public String getRecruitingUrl() { return recruitingUrl; }
    public String getRecruitingText(){ return recruitingText; }

    public void setName(String name)                  { this.name = name; }
    public void setFullName(String fullName)           { this.fullName = fullName; }
    public void setDescription(String description)     { this.description = description; }
    public void setCategory(String category)           { this.category = category; }
    public void setColor(String color)                 { this.color = color; }
    public void setLogoUrl(String logoUrl)             { this.logoUrl = logoUrl; }
    public void setBackgroundUrl(String backgroundUrl) { this.backgroundUrl = backgroundUrl; }
    public void setInstagram(String instagram)         { this.instagram = instagram; }
    public void setLinkedinUrl(String linkedinUrl)     { this.linkedinUrl = linkedinUrl; }
    public void setWebsiteUrl(String websiteUrl)       { this.websiteUrl = websiteUrl; }
    public void setContactEmail(String contactEmail)   { this.contactEmail = contactEmail; }
    public void setRecruitingOpen(boolean open)        { this.recruitingOpen = open; }
    public void setRecruitingUrl(String recruitingUrl) { this.recruitingUrl = recruitingUrl; }
    public void setRecruitingText(String text)         { this.recruitingText = text; }
}
