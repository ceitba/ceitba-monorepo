package org.ceitba.api.repository.news;

import jakarta.persistence.LockModeType;
import org.ceitba.api.domain.news.ArticleVote;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;

public interface ArticleVoteRepository extends JpaRepository<ArticleVote, String> {

    // Creates the aggregate row without racing a concurrent first vote.
    @Modifying
    @Query(value = """
        INSERT INTO public.article_votes (article_id) VALUES (:articleId)
        ON CONFLICT (article_id) DO NOTHING
        """, nativeQuery = true)
    void insertIfAbsent(@Param("articleId") String articleId);

    // SELECT ... FOR UPDATE: serializes vote changes on one article so the
    // read-modify-write of the counters (and the per-fingerprint record
    // check) cannot interleave.
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT v FROM ArticleVote v WHERE v.articleId = :articleId")
    Optional<ArticleVote> findByIdForUpdate(@Param("articleId") String articleId);
}
