package org.ceitba.api.domain.news;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.OffsetDateTime;

@Entity
@Table(schema = "public", name = "analytics_events")
public class AnalyticsEvent {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String type;

    @Column(name = "session_id", nullable = false)
    private String sessionId;

    @Column(nullable = false)
    private OffsetDateTime ts = OffsetDateTime.now();

    @Column(name = "article_id")
    private String articleId;

    // Event detail page views ('event_view'), V55.
    @Column(name = "event_id")
    private String eventId;

    @Column
    private String category;

    @Column
    private String path;

    @Column(name = "ip_hash")
    private String ipHash;

    protected AnalyticsEvent() {}

    public AnalyticsEvent(String type, String sessionId, OffsetDateTime ts,
                          String articleId, String eventId, String category, String path, String ipHash) {
        this.type      = type;
        this.sessionId = sessionId;
        this.ts        = ts != null ? ts : OffsetDateTime.now();
        this.articleId = articleId;
        this.eventId   = eventId;
        this.category  = category;
        this.path      = path;
        this.ipHash    = ipHash;
    }
}
