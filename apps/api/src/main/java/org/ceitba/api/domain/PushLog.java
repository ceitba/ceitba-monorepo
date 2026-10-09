package org.ceitba.api.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.CreationTimestamp;

import java.time.OffsetDateTime;

// One push fan-out and its reach (V56), written by PushTriggerListener.
@Entity
@Table(schema = "public", name = "push_log")
public class PushLog {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    // The message's "org" data key; null when the push isn't about an org.
    @Column(name = "org_slug")
    private String orgSlug;

    // The message's "type" data key (article, event, organization…).
    @Column
    private String kind;

    @Column(name = "ref_id")
    private String refId;

    @Column(nullable = false)
    private int targeted;

    @Column(nullable = false)
    private int sent;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    protected PushLog() {}

    public PushLog(String orgSlug, String kind, String refId, int targeted, int sent) {
        this.orgSlug = orgSlug;
        this.kind = kind;
        this.refId = refId;
        this.targeted = targeted;
        this.sent = sent;
    }

    public String getOrgSlug() { return orgSlug; }
    public String getKind()    { return kind; }
    public int getTargeted()   { return targeted; }
    public int getSent()       { return sent; }
}
