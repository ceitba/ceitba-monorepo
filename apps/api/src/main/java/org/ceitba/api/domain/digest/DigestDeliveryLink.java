package org.ceitba.api.domain.digest;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;

import java.io.Serializable;
import java.util.Objects;

// A per-reader link of one delivery (unsubscribe, "Tu cuatrimestre"), the
// target of /v1/mail/c/{trackingId}/{linkId} for linkId >= 1000.
@Entity
@Table(schema = "public", name = "digest_delivery_links")
@IdClass(DigestDeliveryLink.Key.class)
public class DigestDeliveryLink {

    @Id
    @Column(name = "tracking_id")
    private String trackingId;

    @Id
    @Column(name = "link_id")
    private int linkId;

    @Column(nullable = false)
    private String url;

    @Column(name = "url_key", nullable = false)
    private String urlKey;

    @Column(nullable = false)
    private String label;

    protected DigestDeliveryLink() {}

    public DigestDeliveryLink(String trackingId, int linkId, String url, String urlKey, String label) {
        this.trackingId = trackingId;
        this.linkId = linkId;
        this.url = url;
        this.urlKey = urlKey;
        this.label = label;
    }

    public String getTrackingId() { return trackingId; }
    public int getLinkId() { return linkId; }
    public String getUrl() { return url; }
    public String getUrlKey() { return urlKey; }
    public String getLabel() { return label; }

    public static class Key implements Serializable {
        private String trackingId;
        private int linkId;

        public Key() {}

        public Key(String trackingId, int linkId) {
            this.trackingId = trackingId;
            this.linkId = linkId;
        }

        @Override
        public boolean equals(Object o) {
            return o instanceof Key k && linkId == k.linkId && Objects.equals(trackingId, k.trackingId);
        }

        @Override
        public int hashCode() {
            return Objects.hash(trackingId, linkId);
        }
    }
}
