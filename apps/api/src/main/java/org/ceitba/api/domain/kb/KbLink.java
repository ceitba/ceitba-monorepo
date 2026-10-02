package org.ceitba.api.domain.kb;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.util.UUID;

// One wikilink target of a page body; toPageId stays null until the target
// page exists (KbLinkRepository.resolveForSubject).
@Entity
@Table(schema = "wiki", name = "kb_link")
public class KbLink {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "from_page_id", nullable = false)
    private UUID fromPageId;

    @Column(nullable = false, length = 256)
    private String raw;

    @Column(name = "to_subject_id", nullable = false, length = 25)
    private String toSubjectId;

    @Column(name = "to_slug", nullable = false, length = 128)
    private String toSlug;

    @Column(name = "to_page_id")
    private UUID toPageId;

    protected KbLink() {}

    public KbLink(UUID fromPageId, String raw, String toSubjectId, String toSlug) {
        this.fromPageId = fromPageId;
        this.raw = raw;
        this.toSubjectId = toSubjectId;
        this.toSlug = toSlug;
    }

    public UUID getId() { return id; }
    public UUID getFromPageId() { return fromPageId; }
    public String getRaw() { return raw; }
    public String getToSubjectId() { return toSubjectId; }
    public String getToSlug() { return toSlug; }
    public UUID getToPageId() { return toPageId; }
}
