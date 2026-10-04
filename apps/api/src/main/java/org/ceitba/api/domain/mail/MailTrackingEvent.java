package org.ceitba.api.domain.mail;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.OffsetDateTime;

// One open (pixel fetch) or click (redirect) of a tracked email. Flagged
// events (scanners, bots, within seconds of sending) are kept but excluded
// from the stats. No IP and no full user agent: only a coarse client class.
@Entity
@Table(schema = "public", name = "mail_tracking_event")
public class MailTrackingEvent {

    public static final String OPEN = "open";
    public static final String CLICK = "click";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "tracking_id", nullable = false)
    private String trackingId;

    @Column(nullable = false)
    private String type;

    @Column(name = "link_id")
    private Integer linkId;

    @Column(nullable = false)
    private OffsetDateTime at;

    @Column(nullable = false)
    private boolean flagged;

    @Column(name = "flag_reason")
    private String flagReason;

    @Column(name = "ua_class", nullable = false)
    private String uaClass;

    protected MailTrackingEvent() {}

    public MailTrackingEvent(String trackingId, String type, Integer linkId, OffsetDateTime at,
                             String flagReason, String uaClass) {
        this.trackingId = trackingId;
        this.type = type;
        this.linkId = linkId;
        this.at = at;
        this.flagged = flagReason != null;
        this.flagReason = flagReason;
        this.uaClass = uaClass;
    }

    public Long getId() { return id; }
    public String getTrackingId() { return trackingId; }
    public String getType() { return type; }
    public Integer getLinkId() { return linkId; }
    public OffsetDateTime getAt() { return at; }
    public boolean isFlagged() { return flagged; }
    public String getFlagReason() { return flagReason; }
    public String getUaClass() { return uaClass; }
}
