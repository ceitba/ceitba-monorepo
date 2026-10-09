package org.ceitba.api.domain.orgmail;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.CreationTimestamp;

import java.time.OffsetDateTime;
import java.util.UUID;

// An email an organization's admin writes to the org's followers (V57).
// draft -> sending (recipients snapshot in org_announcement_deliveries) ->
// sent (no pending delivery left). Only drafts are edited.
@Entity
@Table(schema = "public", name = "org_announcements")
public class OrgAnnouncement {

    public static final String DRAFT = "draft";
    public static final String SENDING = "sending";
    public static final String SENT = "sent";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "org_slug", nullable = false)
    private String orgSlug;

    @Column(nullable = false)
    private String subject;

    // Plain text; the renderer escapes it and turns URLs into links.
    @Column(nullable = false)
    private String body;

    @Column(nullable = false)
    private String status = DRAFT;

    // The org's connected account at send time.
    @Column(name = "sender_email")
    private String senderEmail;

    @Column(name = "recipient_count")
    private Integer recipientCount;

    @Column(name = "created_by")
    private UUID createdBy;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @Column(name = "sent_at")
    private OffsetDateTime sentAt;

    @Column(name = "finished_at")
    private OffsetDateTime finishedAt;

    protected OrgAnnouncement() {}

    public OrgAnnouncement(String orgSlug, String subject, String body, UUID createdBy) {
        this.orgSlug = orgSlug;
        this.subject = subject;
        this.body = body;
        this.createdBy = createdBy;
    }

    public Long getId()                   { return id; }
    public String getOrgSlug()            { return orgSlug; }
    public String getSubject()            { return subject; }
    public String getBody()               { return body; }
    public String getStatus()             { return status; }
    public String getSenderEmail()        { return senderEmail; }
    public Integer getRecipientCount()    { return recipientCount; }
    public UUID getCreatedBy()            { return createdBy; }
    public OffsetDateTime getCreatedAt()  { return createdAt; }
    public OffsetDateTime getSentAt()     { return sentAt; }
    public OffsetDateTime getFinishedAt() { return finishedAt; }

    public void setSubject(String subject) { this.subject = subject; }
    public void setBody(String body)       { this.body = body; }

    public void startSending(String senderEmail, int recipients, OffsetDateTime now) {
        this.status = SENDING;
        this.senderEmail = senderEmail;
        this.recipientCount = recipients;
        this.sentAt = now;
    }
}
