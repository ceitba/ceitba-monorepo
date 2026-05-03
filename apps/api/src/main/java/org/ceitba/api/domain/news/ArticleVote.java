package org.ceitba.api.domain.news;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.OffsetDateTime;

@Entity
@Table(schema = "public", name = "article_votes")
public class ArticleVote {

    @Id
    @Column(name = "article_id")
    private String articleId;

    @Column(name = "up_count", nullable = false)
    private int upCount = 0;

    @Column(name = "down_count", nullable = false)
    private int downCount = 0;

    @Column(name = "updated_at")
    private OffsetDateTime updatedAt = OffsetDateTime.now();

    protected ArticleVote() {}

    public ArticleVote(String articleId) {
        this.articleId = articleId;
    }

    public String getArticleId() { return articleId; }
    public int getUpCount()      { return upCount; }
    public int getDownCount()    { return downCount; }

    public void incrementUp()   { upCount++;   updatedAt = OffsetDateTime.now(); }
    public void incrementDown() { downCount++; updatedAt = OffsetDateTime.now(); }
    public void decrementUp()   { if (upCount   > 0) { upCount--;   updatedAt = OffsetDateTime.now(); } }
    public void decrementDown() { if (downCount > 0) { downCount--; updatedAt = OffsetDateTime.now(); } }
}
