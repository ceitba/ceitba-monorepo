package org.ceitba.api.domain.digest;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;

import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;

// A link shared by every email of an issue (articles, events, footer), the
// target of /v1/mail/c/{trackingId}/{linkId} for linkId < 1000.
@Entity
@Table(schema = "public", name = "digest_issue_links")
@IdClass(DigestIssueLink.Key.class)
public class DigestIssueLink {

    @Id
    @Column(name = "issue_id")
    private UUID issueId;

    @Id
    @Column(name = "link_id")
    private int linkId;

    @Column(nullable = false)
    private String url;

    @Column(name = "url_key", nullable = false)
    private String urlKey;

    @Column(nullable = false)
    private String label;

    protected DigestIssueLink() {}

    public DigestIssueLink(UUID issueId, int linkId, String url, String urlKey, String label) {
        this.issueId = issueId;
        this.linkId = linkId;
        this.url = url;
        this.urlKey = urlKey;
        this.label = label;
    }

    public UUID getIssueId() { return issueId; }
    public int getLinkId() { return linkId; }
    public String getUrl() { return url; }
    public String getUrlKey() { return urlKey; }
    public String getLabel() { return label; }

    public static class Key implements Serializable {
        private UUID issueId;
        private int linkId;

        public Key() {}

        public Key(UUID issueId, int linkId) {
            this.issueId = issueId;
            this.linkId = linkId;
        }

        @Override
        public boolean equals(Object o) {
            return o instanceof Key k && linkId == k.linkId && Objects.equals(issueId, k.issueId);
        }

        @Override
        public int hashCode() {
            return Objects.hash(issueId, linkId);
        }
    }
}
