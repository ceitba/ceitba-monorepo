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

    @Column(name = "member_count")
    private int memberCount;

    @Column(name = "founded_year")
    private Integer foundedYear;

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
    public int getMemberCount()    { return memberCount; }
    public Integer getFoundedYear(){ return foundedYear; }

    public void setName(String name)               { this.name = name; }
    public void setFullName(String fullName)        { this.fullName = fullName; }
    public void setDescription(String description)  { this.description = description; }
    public void setCategory(String category)        { this.category = category; }
    public void setColor(String color)              { this.color = color; }
    public void setMemberCount(int memberCount)     { this.memberCount = memberCount; }
    public void setFoundedYear(Integer foundedYear) { this.foundedYear = foundedYear; }
}
