package org.ceitba.api.service.news;

import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.domain.news.ArticleVote;
import org.ceitba.api.domain.news.VoteRecord;
import org.ceitba.api.domain.news.VoteRecordId;
import org.ceitba.api.repository.news.ArticleRepository;
import org.ceitba.api.repository.news.ArticleVoteRepository;
import org.ceitba.api.repository.news.VoteRecordRepository;
import org.ceitba.api.service.crypto.ContentHmac;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Optional;

@Service
public class VoteService {

    private final ArticleRepository articleRepo;
    private final ArticleVoteRepository voteRepo;
    private final VoteRecordRepository recordRepo;
    private final ContentHmac hmac;

    public VoteService(ArticleRepository articleRepo,
                       ArticleVoteRepository voteRepo,
                       VoteRecordRepository recordRepo,
                       ContentHmac hmac) {
        this.articleRepo = articleRepo;
        this.voteRepo    = voteRepo;
        this.recordRepo  = recordRepo;
        this.hmac        = hmac;
    }

    // Returns current counts after casting the vote.
    // If the fingerprint already voted with the same type, it's a no-op.
    // If it voted the opposite type, the old vote is retracted first.
    // A vote stored under the legacy unkeyed fingerprint is recognized and
    // re-keyed to the HMAC fingerprint (lazy migration).
    @Transactional
    public ArticleVote cast(String articleId, String ip, String userAgent, String voteType) {
        requireArticleExists(articleId);
        String fingerprint = fingerprint(ip, userAgent);
        var aggregate = lockAggregate(articleId);

        findExisting(articleId, fingerprint, ip, userAgent).ifPresentOrElse(
            existing -> {
                boolean legacy = !existing.getId().getFingerprint().equals(fingerprint);
                boolean changed = !existing.getVoteType().equals(voteType);
                if (changed) {
                    retractFromAggregate(aggregate, existing.getVoteType());
                    incrementAggregate(aggregate, voteType);
                }
                if (changed || legacy) {
                    recordRepo.delete(existing);
                    recordRepo.save(changed
                        ? new VoteRecord(articleId, fingerprint, voteType)
                        : new VoteRecord(articleId, fingerprint, voteType, existing.getCreatedAt()));
                }
                // same type, already HMAC-keyed → no-op
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
        var aggregate = lockAggregate(articleId);
        var record = findExisting(articleId, fingerprint, ip, userAgent)
            .orElseThrow(() -> new ResourceNotFoundException("VoteRecord", articleId));
        retractFromAggregate(aggregate, record.getVoteType());
        recordRepo.delete(record);
        return voteRepo.save(aggregate);
    }

    @Transactional(readOnly = true)
    public ArticleVote getCounts(String articleId) {
        return voteRepo.findById(articleId)
            .orElseGet(() -> new ArticleVote(articleId));
    }

    private void requireArticleExists(String articleId) {
        if (!articleRepo.existsById(articleId)) {
            throw new ResourceNotFoundException("Article", articleId);
        }
    }

    // Concurrent votes on the same article used to read the same counters
    // and overwrite each other (lost updates), and two identical votes could
    // both pass the "no record yet" check. Locking the aggregate row first
    // serializes them; the lock is held until the transaction commits.
    private ArticleVote lockAggregate(String articleId) {
        voteRepo.insertIfAbsent(articleId);
        return voteRepo.findByIdForUpdate(articleId)
            .orElseThrow(() -> new ResourceNotFoundException("Article", articleId));
    }

    private void incrementAggregate(ArticleVote agg, String type) {
        if ("up".equals(type)) agg.incrementUp();
        else                   agg.incrementDown();
    }

    private void retractFromAggregate(ArticleVote agg, String type) {
        if ("up".equals(type)) agg.decrementUp();
        else                   agg.decrementDown();
    }

    // The voter's row: under the HMAC fingerprint, or — for votes cast before
    // the switch to HMAC — under the legacy unkeyed fingerprint. Called with
    // the aggregate row locked, so a concurrent request can't migrate the same
    // legacy row twice.
    private Optional<VoteRecord> findExisting(String articleId, String fingerprint,
                                              String ip, String userAgent) {
        return recordRepo.findById(new VoteRecordId(articleId, fingerprint))
            .or(() -> recordRepo.findById(
                new VoteRecordId(articleId, legacyFingerprint(ip, userAgent))));
    }

    // HMAC-SHA256(ip + "|" + userAgent) under a server-side key (see
    // ContentHmac). The raw IP is never stored, and unlike a plain hash the
    // stored value can't be reversed by enumerating the IPv4 space.
    String fingerprint(String ip, String userAgent) {
        return hmac.signHex(ContentHmac.VOTE_FINGERPRINTS, fingerprintInput(ip, userAgent));
    }

    // Unkeyed SHA-256(ip + "|" + userAgent), what vote_records held before
    // the HMAC switch. Only used to recognize (and re-key) those old rows.
    static String legacyFingerprint(String ip, String userAgent) {
        try {
            var md = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(
                md.digest(fingerprintInput(ip, userAgent).getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    private static String fingerprintInput(String ip, String userAgent) {
        return (ip == null ? "" : ip) + "|" + (userAgent == null ? "" : userAgent);
    }
}
