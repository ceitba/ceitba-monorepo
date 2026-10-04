package org.ceitba.api.service.digest;

import org.ceitba.api.common.exception.InvalidStateException;
import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.config.ClockConfig;
import org.ceitba.api.config.DigestProperties;
import org.ceitba.api.domain.Commission;
import org.ceitba.api.domain.Subject;
import org.ceitba.api.domain.User;
import org.ceitba.api.domain.correction.CorrectionSlot;
import org.ceitba.api.domain.correction.ScheduleCorrection;
import org.ceitba.api.domain.correction.ScheduleCorrectionVote;
import org.ceitba.api.domain.correction.ScheduleCorrectionVoteId;
import org.ceitba.api.domain.correction.ScheduleCorrectionVoteType;
import org.ceitba.api.repository.CommissionRepository;
import org.ceitba.api.repository.SubjectRepository;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.repository.correction.ScheduleCorrectionRepository;
import org.ceitba.api.repository.correction.ScheduleCorrectionVoteRepository;
import org.ceitba.api.service.correction.CorrectionSlots;
import org.ceitba.api.service.correction.ScheduleCorrectionException;
import org.ceitba.api.service.correction.ScheduleCorrectionService;
import org.ceitba.api.web.digest.dto.DigestDtos;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.LocalDate;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

// The digest's "¿Es así?" links (docs/WEEKLY-DIGEST.md). The ItbaNews
// /correction page shows the correction (GET, read-only: mail scanners
// follow links) and votes with a button (POST). The vote goes through
// ScheduleCorrectionService.vote as the token's user, so dedupe (one vote per
// user, changing it replaces it), the 3-confirm rule, the commission lock and
// anonymity are exactly those of the in-app vote.
@Service
public class DigestCorrectionVoteService {

    private final DigestCorrectionVoteTokens tokens;
    private final ScheduleCorrectionService correctionService;
    private final ScheduleCorrectionRepository corrections;
    private final ScheduleCorrectionVoteRepository votes;
    private final CommissionRepository commissions;
    private final SubjectRepository subjects;
    private final UserRepository users;
    private final DigestProperties digestProps;
    private final Clock clock;

    public DigestCorrectionVoteService(DigestCorrectionVoteTokens tokens, ScheduleCorrectionService correctionService,
                                       ScheduleCorrectionRepository corrections,
                                       ScheduleCorrectionVoteRepository votes, CommissionRepository commissions,
                                       SubjectRepository subjects, UserRepository users,
                                       DigestProperties digestProps, Clock clock) {
        this.tokens = tokens;
        this.correctionService = correctionService;
        this.corrections = corrections;
        this.votes = votes;
        this.commissions = commissions;
        this.subjects = subjects;
        this.users = users;
        this.digestProps = digestProps;
        this.clock = clock;
    }

    // GET /v1/digests/correction-vote?token= — never writes.
    @Transactional(readOnly = true)
    public DigestDtos.CorrectionVoteView view(String token) {
        var t = holder(token);
        return load(t);
    }

    // POST /v1/digests/correction-vote. Not transactional itself: the vote is
    // ScheduleCorrectionService's own transaction, so its state errors can be
    // mapped here to this endpoint's codes.
    public DigestDtos.CorrectionVoteResult vote(String token, String vote) {
        var type = parseVote(vote);
        var t = holder(token);
        var before = load(t);
        if (!before.open()) throw closed(before.status());
        try {
            correctionService.vote(t.correctionId(), t.userId(), type);
        } catch (InvalidStateException | ScheduleCorrectionException e) {
            throw closed(e.getMessage());
        } catch (ResourceNotFoundException e) {
            throw notFound();
        }
        return new DigestDtos.CorrectionVoteResult(load(t), before.myVote());
    }

    // ------------------------------------------------------------ helpers

    private DigestCorrectionVoteTokens.Valid holder(String token) {
        var verified = tokens.verify(token);
        if (verified instanceof DigestCorrectionVoteTokens.Expired) {
            throw new DigestException(DigestException.Reason.TOKEN_EXPIRED, "This link has expired");
        }
        if (!(verified instanceof DigestCorrectionVoteTokens.Valid valid)) {
            throw new DigestException(DigestException.Reason.INVALID_TOKEN, "Invalid correction vote token");
        }
        // A deleted account's links stop working; so do those of an address
        // the digest no longer goes to (same guard as sending).
        User user = users.findById(valid.userId()).orElseThrow(() ->
            new DigestException(DigestException.Reason.INVALID_TOKEN, "Invalid correction vote token"));
        if (!digestProps.isAllowedRecipient(user.getEmail())) {
            throw new DigestException(DigestException.Reason.EMAIL_NOT_ALLOWED,
                "Digest links only work for " + String.join(", ", digestProps.allowedDomains()) + " addresses");
        }
        return valid;
    }

    // Repository reads only (commission times fetched eagerly), so it also
    // works outside a transaction, before and after the vote.
    private DigestDtos.CorrectionVoteView load(DigestCorrectionVoteTokens.Valid t) {
        ScheduleCorrection c = corrections.findById(t.correctionId()).orElseThrow(DigestCorrectionVoteService::notFound);
        Commission commission = commissions.findByIdInWithTimes(List.of(c.getCommissionId())).stream()
            .findFirst().orElseThrow(DigestCorrectionVoteService::notFound);
        String subjectName = subjects.findById(commission.getSubjectCode()).map(Subject::getName)
            .orElse(commission.getSubjectCode());
        boolean ended = commission.getCourseEnd().isBefore(LocalDate.now(clock));
        String myVote = votes.findById(new ScheduleCorrectionVoteId(c.getId(), t.userId()))
            .map(ScheduleCorrectionVote::getType).map(Enum::name).orElse(null);
        return new DigestDtos.CorrectionVoteView(c.getId(), commission.getSubjectCode(), subjectName,
            commission.getCommissionName(), c.getStatus().name(), c.getStatus().isOpen() && !ended,
            slots(c.getProposedSlots()), slots(CorrectionSlots.fromTimes(commission.getTimes())),
            c.getConfirmCount(), c.getRejectCount(), myVote,
            t.expiresAt().atZone(ClockConfig.ZONE).toOffsetDateTime());
    }

    private static List<DigestDtos.Slot> slots(List<CorrectionSlot> list) {
        return list.stream().map(s -> new DigestDtos.Slot(s.day(), s.from(), s.to())).toList();
    }

    static ScheduleCorrectionVoteType parseVote(String vote) {
        if (vote != null) {
            switch (vote.trim().toLowerCase(Locale.ROOT)) {
                case "confirm" -> { return ScheduleCorrectionVoteType.CONFIRM; }
                case "reject" -> { return ScheduleCorrectionVoteType.REJECT; }
                default -> { }
            }
        }
        throw new DigestException(DigestException.Reason.INVALID_VOTE, "vote must be confirm or reject");
    }

    private static DigestException notFound() {
        return new DigestException(DigestException.Reason.CORRECTION_NOT_FOUND, "Schedule correction not found");
    }

    private static DigestException closed(String detail) {
        return new DigestException(DigestException.Reason.CORRECTION_CLOSED,
            "This correction no longer accepts votes (" + detail + ")");
    }
}
