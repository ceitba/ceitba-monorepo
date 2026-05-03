package org.ceitba.api.service.news;

import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.domain.news.ArticleVote;
import org.ceitba.api.domain.news.VoteRecord;
import org.ceitba.api.domain.news.VoteRecordId;
import org.ceitba.api.repository.news.ArticleRepository;
import org.ceitba.api.repository.news.ArticleVoteRepository;
import org.ceitba.api.repository.news.VoteRecordRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

@Service
public class VoteService {

    private final ArticleRepository articleRepo;
    private final ArticleVoteRepository voteRepo;
    private final VoteRecordRepository recordRepo;

    public VoteService(ArticleRepository articleRepo,
                       ArticleVoteRepository voteRepo,
                       VoteRecordRepository recordRepo) {
        this.articleRepo = articleRepo;
        this.voteRepo    = voteRepo;
        this.recordRepo  = recordRepo;
    }

    // Returns current counts after casting the vote.
    // If the fingerprint already voted with the same type, it's a no-op.
    // If it voted the opposite type, the old vote is retracted first.
    @Transactional
    public ArticleVote cast(String articleId, String ip, String userAgent, String voteType) {
        requireArticleExists(articleId);
        String fingerprint = fingerprint(ip, userAgent);
        var recordId = new VoteRecordId(articleId, fingerprint);
        var aggregate = voteRepo.findById(articleId)
            .orElseGet(() -> voteRepo.save(new ArticleVote(articleId)));

        recordRepo.findById(recordId).ifPresentOrElse(
            existing -> {
                if (!existing.getVoteType().equals(voteType)) {
                    retractFromAggregate(aggregate, existing.getVoteType());
                    recordRepo.delete(existing);
                    recordRepo.save(new VoteRecord(articleId, fingerprint, voteType));
                    incrementAggregate(aggregate, voteType);
                }
                // same type → no-op
            },
            () -> {
                recordRepo.save(new VoteRecord(articleId, fingerprint, voteType));
                incrementAggregate(aggregate, voteType);
            }
        );
        return voteRepo.save(aggregate);
    }

    // Returns current counts after retracting. 404 if no prior vote.
    @Transactional
    public ArticleVote retract(String articleId, String ip, String userAgent) {
        requireArticleExists(articleId);
        String fingerprint = fingerprint(ip, userAgent);
        var recordId = new VoteRecordId(articleId, fingerprint);
        var record = recordRepo.findById(recordId)
            .orElseThrow(() -> new ResourceNotFoundException("VoteRecord", articleId));
        var aggregate = voteRepo.findById(articleId)
            .orElseGet(() -> new ArticleVote(articleId));
        retractFromAggregate(aggregate, record.getVoteType());
        recordRepo.delete(record);
        return voteRepo.save(aggregate);
    }

    public ArticleVote getCounts(String articleId) {
        return voteRepo.findById(articleId)
            .orElseGet(() -> new ArticleVote(articleId));
    }

    private void requireArticleExists(String articleId) {
        if (!articleRepo.existsById(articleId)) {
            throw new ResourceNotFoundException("Article", articleId);
        }
    }

    private void incrementAggregate(ArticleVote agg, String type) {
        if ("up".equals(type)) agg.incrementUp();
        else                   agg.incrementDown();
    }

    private void retractFromAggregate(ArticleVote agg, String type) {
        if ("up".equals(type)) agg.decrementUp();
        else                   agg.decrementDown();
    }

    // SHA-256(ip + "|" + userAgent) — no PII stored.
    static String fingerprint(String ip, String userAgent) {
        try {
            var md = MessageDigest.getInstance("SHA-256");
            var raw = ((ip == null ? "" : ip) + "|" + (userAgent == null ? "" : userAgent))
                          .getBytes(StandardCharsets.UTF_8);
            var digest = md.digest(raw);
            var sb = new StringBuilder(64);
            for (byte b : digest) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new RuntimeException(e);
        }
    }
}
