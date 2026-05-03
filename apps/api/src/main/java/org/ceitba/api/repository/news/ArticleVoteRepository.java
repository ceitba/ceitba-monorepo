package org.ceitba.api.repository.news;

import org.ceitba.api.domain.news.ArticleVote;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ArticleVoteRepository extends JpaRepository<ArticleVote, String> {}
