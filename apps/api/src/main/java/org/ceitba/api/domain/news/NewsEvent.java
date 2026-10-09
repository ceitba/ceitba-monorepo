package org.ceitba.api.domain.news;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import org.ceitba.api.domain.User;

import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;

@Entity
@Table(schema = "public", name = "news_events")
public class NewsEvent {

    @Id
    private String id;

    @Column(nullable = false)
    private String title;

    @Column(name = "event_date", nullable = false)
    private LocalDate eventDate;

    @Column(name = "start_time", nullable = false)
    private LocalTime startTime;

    @Column(name = "end_time", nullable = false)
    private LocalTime endTime;

    @Column(nullable = false)
    private String location;

    @Column(nullable = false)
    private String category;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "organization")
    private Organization organization;

    @Column
    private String description;

    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt = OffsetDateTime.now();

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "created_by")
    private User createdBy;

    @Column(name = "cover_image")
    private String coverImage;

    @Column(name = "online_url")
    private String onlineUrl;

    // SIGNUP_* (V56 CHECK): how people sign up.
    @Column(name = "signup_mode", nullable = false)
    private String signupMode = SIGNUP_NONE;

    // The external form, for SIGNUP_EXTERNAL.
    @Column(name = "signup_url")
    private String signupUrl;

    // Max RSVPs for SIGNUP_RSVP; null = no limit.
    @Column
    private Integer capacity;

    // Set once the day-before reminder went out (EventReminderService).
    @Column(name = "reminder_sent_at")
    private OffsetDateTime reminderSentAt;

    public static final String SIGNUP_NONE = "none";
    public static final String SIGNUP_EXTERNAL = "external";
    public static final String SIGNUP_RSVP = "rsvp";

    protected NewsEvent() {}

    public NewsEvent(String id, String title, LocalDate eventDate,
                     LocalTime startTime, LocalTime endTime,
                     String location, String category) {
        this.id        = id;
        this.title     = title;
        this.eventDate = eventDate;
        this.startTime = startTime;
        this.endTime   = endTime;
        this.location  = location;
        this.category  = category;
    }

    public String getId()              { return id; }
    public String getTitle()           { return title; }
    public LocalDate getEventDate()    { return eventDate; }
    public LocalTime getStartTime()    { return startTime; }
    public LocalTime getEndTime()      { return endTime; }
    public String getLocation()        { return location; }
    public String getCategory()        { return category; }
    public Organization getOrganization() { return organization; }
    public String getDescription()     { return description; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
    public User getCreatedBy()         { return createdBy; }
    public String getCoverImage()      { return coverImage; }
    public String getOnlineUrl()       { return onlineUrl; }
    public String getSignupMode()      { return signupMode; }
    public String getSignupUrl()       { return signupUrl; }
    public Integer getCapacity()       { return capacity; }
    public OffsetDateTime getReminderSentAt() { return reminderSentAt; }

    public void setTitle(String title)           { this.title = title; }
    public void setEventDate(LocalDate eventDate){ this.eventDate = eventDate; }
    public void setStartTime(LocalTime startTime){ this.startTime = startTime; }
    public void setEndTime(LocalTime endTime)    { this.endTime = endTime; }
    public void setLocation(String location)     { this.location = location; }
    public void setCategory(String category)     { this.category = category; }
    public void setOrganization(Organization o)  { this.organization = o; }
    public void setDescription(String description){ this.description = description; }
    public void setCreatedBy(User createdBy)     { this.createdBy = createdBy; }
    public void setCoverImage(String coverImage) { this.coverImage = coverImage; }
    public void setOnlineUrl(String onlineUrl)   { this.onlineUrl = onlineUrl; }
    public void setSignupMode(String signupMode) { this.signupMode = signupMode; }
    public void setSignupUrl(String signupUrl)   { this.signupUrl = signupUrl; }
    public void setCapacity(Integer capacity)    { this.capacity = capacity; }
    public void setReminderSentAt(OffsetDateTime at) { this.reminderSentAt = at; }
}
