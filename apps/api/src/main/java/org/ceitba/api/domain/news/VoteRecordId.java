package org.ceitba.api.domain.news;

import jakarta.persistence.Embeddable;

import java.io.Serializable;
import java.util.Objects;

@Embeddable
public class VoteRecordId implements Serializable {

    private String articleId;
    private String fingerprint;

    protected VoteRecordId() {}

    public VoteRecordId(String articleId, String fingerprint) {
        this.articleId   = articleId;
        this.fingerprint = fingerprint;
    }

    public String getArticleId()   { return articleId; }
    public String getFingerprint() { return fingerprint; }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof VoteRecordId that)) return false;
        return Objects.equals(articleId, that.articleId) &&
               Objects.equals(fingerprint, that.fingerprint);
    }

    @Override
    public int hashCode() {
        return Objects.hash(articleId, fingerprint);
    }
}
