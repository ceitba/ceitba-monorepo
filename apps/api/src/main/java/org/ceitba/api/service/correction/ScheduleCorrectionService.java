package org.ceitba.api.service.correction;

import org.ceitba.api.common.exception.InvalidStateException;
import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.domain.Commission;
import org.ceitba.api.domain.Subject;
import org.ceitba.api.domain.correction.CorrectionSlot;
import org.ceitba.api.domain.correction.ScheduleCorrection;
import org.ceitba.api.domain.correction.ScheduleCorrectionStatus;
import org.ceitba.api.domain.correction.ScheduleCorrectionVote;
import org.ceitba.api.domain.correction.ScheduleCorrectionVoteId;
import org.ceitba.api.domain.correction.ScheduleCorrectionVoteType;
import org.ceitba.api.repository.CommissionRepository;
import org.ceitba.api.repository.SubjectRepository;
import org.ceitba.api.repository.correction.ScheduleCorrectionRepository;
import org.ceitba.api.repository.correction.ScheduleCorrectionVoteRepository;
import org.ceitba.api.service.push.PushMessage;
import org.ceitba.api.service.push.events.PushToUsers;
import org.ceitba.api.web.correction.dto.CorrectionResponse;
import org.ceitba.api.web.correction.dto.MyCorrectionResponse;
import org.ceitba.api.web.correction.dto.ScheduleSlotInput;
import org.ceitba.api.web.correction.dto.StaffCorrectionResponse;
import org.ceitba.api.web.correction.dto.SuggestCorrectionResponse;
import org.ceitba.api.web.news.dto.PageResponse;
import org.ceitba.api.web.subject.dto.OrganizedSubjectsResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.Comparator;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

import static org.ceitba.api.domain.correction.ScheduleCorrectionStatus.APPLIED;
import static org.ceitba.api.domain.correction.ScheduleCorrectionStatus.PENDING;
import static org.ceitba.api.domain.correction.ScheduleCorrectionStatus.REJECTED;
import static org.ceitba.api.domain.correction.ScheduleCorrectionStatus.RESOLVED;
import static org.ceitba.api.domain.correction.ScheduleCorrectionStatus.SUPERSEDED;

// Student-suggested schedule corrections. See docs/SCHEDULE-CORRECTIONS.md.
//
// Rules:
//   - The suggester's suggestion counts as their CONFIRM vote.
//   - A PENDING correction becomes APPLIED when confirms >= 3 and
//     confirms > rejects; an APPLIED one that stops meeting that rule goes
//     back to PENDING, unless STAFF applied it.
//   - At most one APPLIED correction per commission: applying one (votes or
//     STAFF) supersedes the previous one.
//   - REJECTED / RESOLVED / SUPERSEDED are final.
//
// Concurrency: every write locks the parent commission row first
// (CommissionRepository.findForUpdate), then reads the correction(s) fresh.
// So votes, suggestions, staff reviews and the sync expiry of one commission
// are serialized, and the counters (recounted from the vote rows on every
// change) and the one-applied invariant are exact. A partial unique index
// backs the invariant.
//
// Anonymity: no response built here carries the suggester, the voters or the
// reviewing staff member.
@Service
public class ScheduleCorrectionService {

    private static final Logger log = LoggerFactory.getLogger(ScheduleCorrectionService.class);

    public static final int APPLY_THRESHOLD = 3;
    public static final String PUSH_TYPE = "schedule_correction_applied";
    static final String PUSH_TITLE = "Tu corrección fue aplicada";
    private static final int MAX_PAGE_SIZE = 100;
    private static final Set<ScheduleCorrectionStatus> OPEN = EnumSet.of(PENDING, APPLIED);

    private final ScheduleCorrectionRepository corrections;
    private final ScheduleCorrectionVoteRepository votes;
    private final CommissionRepository commissions;
    private final SubjectRepository subjects;
    private final ApplicationEventPublisher events;
    private final Clock clock;

    public ScheduleCorrectionService(ScheduleCorrectionRepository corrections,
                                     ScheduleCorrectionVoteRepository votes,
                                     CommissionRepository commissions,
                                     SubjectRepository subjects,
                                     ApplicationEventPublisher events,
                                     Clock clock) {
        this.corrections = corrections;
        this.votes = votes;
        this.commissions = commissions;
        this.subjects = subjects;
        this.events = events;
        this.clock = clock;
    }

    // ---- Student actions -------------------------------------------------

    // POST /v1/commissions/{id}/schedule-corrections
    @Transactional
    public SuggestCorrectionResponse suggest(String commissionId, UUID userId, List<ScheduleSlotInput> input) {
        Commission commission = commissions.findForUpdate(commissionId)
            .orElseThrow(() -> new ResourceNotFoundException("Commission", commissionId));
        List<CorrectionSlot> proposed = CorrectionSlots.normalize(input);
        requireNotEnded(commission);

        List<CorrectionSlot> sga = CorrectionSlots.fromTimes(commission.getTimes());
        String key = CorrectionSlots.key(proposed);
        if (key.equals(CorrectionSlots.key(sga))) {
            throw new ScheduleCorrectionException(ScheduleCorrectionException.Reason.SAME_AS_SGA,
                "The proposed schedule is the same as the SGA schedule");
        }

        var identical = corrections.findFirstByCommissionIdAndSlotsKeyAndStatusIn(commissionId, key, OPEN);
        if (identical.isPresent()) {
            var c = identical.get();
            return new SuggestCorrectionResponse(false, toResponse(c, commission, myVote(c.getId(), userId)));
        }
        if (corrections.existsByCommissionIdAndSuggesterIdAndStatus(commissionId, userId, PENDING)) {
            throw new ScheduleCorrectionException(ScheduleCorrectionException.Reason.ALREADY_SUGGESTED,
                "You already have a pending correction for this commission");
        }

        var c = corrections.save(new ScheduleCorrection(commissionId, userId, proposed, sga, key));
        votes.save(new ScheduleCorrectionVote(c.getId(), userId, ScheduleCorrectionVoteType.CONFIRM));
        recountAndEvaluate(c, commission);
        return new SuggestCorrectionResponse(true,
            toResponse(c, commission, ScheduleCorrectionVoteType.CONFIRM));
    }

    // PUT /v1/schedule-corrections/{id}/vote
    @Transactional
    public CorrectionResponse vote(UUID correctionId, UUID userId, ScheduleCorrectionVoteType type) {
        var locked = lock(correctionId);
        var c = locked.correction();
        requireVotable(c, locked.commission());
        var id = new ScheduleCorrectionVoteId(correctionId, userId);
        votes.findById(id).ifPresentOrElse(
            v -> v.setType(type),
            () -> votes.save(new ScheduleCorrectionVote(correctionId, userId, type)));
        recountAndEvaluate(c, locked.commission());
        return toResponse(c, locked.commission(), type);
    }

    // DELETE /v1/schedule-corrections/{id}/vote — idempotent; the suggester
    // may withdraw their implicit CONFIRM too.
    @Transactional
    public CorrectionResponse removeVote(UUID correctionId, UUID userId) {
        var locked = lock(correctionId);
        var c = locked.correction();
        requireVotable(c, locked.commission());
        votes.findById(new ScheduleCorrectionVoteId(correctionId, userId)).ifPresent(votes::delete);
        recountAndEvaluate(c, locked.commission());
        return toResponse(c, locked.commission(), null);
    }

    // GET /v1/me/schedule-corrections — the caller's own suggestions, newest first.
    @Transactional(readOnly = true)
    public List<MyCorrectionResponse> mine(UUID userId) {
        var mine = corrections.findBySuggesterIdOrderByCreatedAtDescIdDesc(userId);
        if (mine.isEmpty()) return List.of();
        var ctx = context(mine);
        Map<UUID, ScheduleCorrectionVoteType> myVotes = myVotes(userId, mine);
        return mine.stream().map(c -> {
            var commission = ctx.commissions().get(c.getCommissionId());
            var base = toResponse(c, commission, myVotes.get(c.getId()));
            String subjectId = commission != null ? commission.getSubjectCode() : null;
            return new MyCorrectionResponse(base.id(), base.commissionId(), base.status(), base.schedule(),
                base.confirms(), base.rejects(), base.myVote(), base.createdAt(),
                subjectId, ctx.subjectName(subjectId),
                commission != null ? commission.getCommissionName() : null,
                instant(c.getAppliedAt()),
                c.getAppliedAt() == null || c.getSeenAt() != null);
        }).toList();
    }

    // POST /v1/me/schedule-corrections/{id}/seen — idempotent. Someone else's
    // correction is a 404, indistinguishable from a missing one.
    @Transactional
    public void markSeen(UUID correctionId, UUID userId) {
        var c = corrections.findByIdAndSuggesterId(correctionId, userId)
            .orElseThrow(() -> new ResourceNotFoundException("ScheduleCorrection", correctionId.toString()));
        if (c.getSeenAt() == null) c.setSeenAt(OffsetDateTime.now(clock));
    }

    // ---- Staff -----------------------------------------------------------

    @Transactional(readOnly = true)
    public PageResponse<StaffCorrectionResponse> staffList(ScheduleCorrectionStatus status, int page, int limit) {
        int size = Math.min(Math.max(limit, 1), MAX_PAGE_SIZE);
        var pageable = PageRequest.of(Math.max(page, 1) - 1, size);
        Page<ScheduleCorrection> result = status == null
            ? corrections.findAllByOrderByCreatedAtDescIdDesc(pageable)
            : corrections.findByStatusOrderByCreatedAtDescIdDesc(status, pageable);
        var ctx = context(result.getContent());
        var data = result.getContent().stream().map(c -> toStaffResponse(c, ctx)).toList();
        return new PageResponse<>(data, new PageResponse.Meta(result.getTotalElements(), Math.max(page, 1), size));
    }

    // Applies a PENDING correction (superseding the applied one) or confirms
    // an APPLIED one as staff-reviewed, so votes can no longer un-apply it.
    @Transactional
    public StaffCorrectionResponse staffApply(UUID correctionId, UUID staffUserId) {
        var locked = lock(correctionId);
        var c = locked.correction();
        requireOpen(c);
        c.markReviewed(staffUserId, OffsetDateTime.now(clock));
        if (c.getStatus() != APPLIED) apply(c, locked.commission());
        return toStaffResponse(c, context(List.of(c)));
    }

    // Rejects a PENDING correction or reverts an APPLIED one. Final: votes
    // never bring a REJECTED correction back.
    @Transactional
    public StaffCorrectionResponse staffReject(UUID correctionId, UUID staffUserId) {
        var locked = lock(correctionId);
        var c = locked.correction();
        requireOpen(c);
        c.markReviewed(staffUserId, OffsetDateTime.now(clock));
        c.setStatus(REJECTED);
        return toStaffResponse(c, context(List.of(c)));
    }

    // ---- Sync ------------------------------------------------------------

    // Called by the sync, inside its per-commission transaction and with the
    // commission row locked, when a commission's SGA slots changed. Every open
    // correction whose snapshot differs from the new SGA slots ends: RESOLVED
    // when SGA now says what the correction proposed, else SUPERSEDED.
    @Transactional
    public void onSgaSlotsChanged(String commissionId, List<CorrectionSlot> newSga) {
        for (var c : corrections.findByCommissionIdAndStatusIn(commissionId, OPEN)) {
            if (CorrectionSlots.sameSet(c.getSgaSnapshot(), newSga)) continue;
            var next = CorrectionSlots.sameSet(c.getProposedSlots(), newSga) ? RESOLVED : SUPERSEDED;
            log.info("Schedule correction {} of commission {}: {} -> {} (SGA slots changed)",
                c.getId(), commissionId, c.getStatus(), next);
            c.setStatus(next);
        }
    }

    // ---- Account deletion ------------------------------------------------

    // DELETE /v1/me, inside AccountDeletionService's transaction: removes the
    // user's votes and recounts and re-evaluates every correction they voted
    // on, exactly like DELETE .../vote would (an APPLIED one can fall back to
    // PENDING, a PENDING one can apply once a REJECT goes). Each commission is
    // locked first, like every other write, in commission-id order so two
    // deletions can't deadlock; a vote racing with the deletion therefore
    // can't recount from a snapshot that still includes the deleted votes.
    // The suggestions themselves stay (detached by AccountDeletionRepository).
    @Transactional
    public void withdrawVotesOf(UUID userId) {
        for (String commissionId : corrections.findCommissionIdsVotedOnBy(userId)) {
            var commission = commissions.findForUpdate(commissionId).orElse(null);
            if (commission == null) continue;
            for (var c : corrections.findByCommissionIdVotedOnBy(commissionId, userId)) {
                votes.deleteById(new ScheduleCorrectionVoteId(c.getId(), userId));
                votes.flush();
                if (c.getStatus().isOpen()) {
                    recountAndEvaluate(c, commission);
                } else {
                    recount(c);
                }
            }
        }
        corrections.flush();
    }

    // ---- Read overlays ---------------------------------------------------

    // GET /v1/subjects: the commission objects with effective schedule,
    // sga_schedule and open corrections, for every given commission (times
    // already hydrated). Two queries total: the open corrections of all the
    // commissions, and the viewer's votes on them (skipped when anonymous).
    @Transactional(readOnly = true)
    public Map<String, OrganizedSubjectsResponse.Commission> organizedCommissions(
            Collection<Commission> list, UUID viewerId) {
        if (list.isEmpty()) return Map.of();
        var ids = list.stream().map(Commission::getId).collect(Collectors.toSet());
        var open = corrections.findByCommissionIdInAndStatusIn(ids, OPEN);
        Map<UUID, ScheduleCorrectionVoteType> myVotes = viewerId == null ? Map.of() : myVotes(viewerId, open);
        Map<String, List<ScheduleCorrection>> byCommission = open.stream()
            .collect(Collectors.groupingBy(ScheduleCorrection::getCommissionId));

        var out = new HashMap<String, OrganizedSubjectsResponse.Commission>();
        for (var commission : list) {
            var sga = CorrectionSlots.sga(commission.getTimes());
            var mine = byCommission.getOrDefault(commission.getId(), List.of()).stream()
                .sorted(PUBLIC_ORDER)
                .toList();
            var applied = mine.stream().filter(c -> c.getStatus() == APPLIED).findFirst().orElse(null);
            var schedule = applied != null ? CorrectionSlots.withRooms(applied.getProposedSlots(), sga) : sga;
            var dtos = mine.stream()
                .map(c -> new OrganizedSubjectsResponse.Correction(
                    c.getId(),
                    c.getStatus().name(),
                    CorrectionSlots.toSchedule(CorrectionSlots.withRooms(c.getProposedSlots(), sga)),
                    c.getConfirmCount(),
                    c.getRejectCount(),
                    myVotes.containsKey(c.getId()) ? myVotes.get(c.getId()).name() : null,
                    instant(c.getCreatedAt())))
                .toList();
            out.put(commission.getId(), new OrganizedSubjectsResponse.Commission(
                commission.getId(),
                commission.getCommissionName(),
                CorrectionSlots.toSchedule(schedule),
                applied != null ? CorrectionSlots.toSchedule(sga) : null,
                dtos));
        }
        return out;
    }

    // GET /v1/commissions: the effective slots (applied correction or SGA) of
    // each given commission (times already hydrated), in one query.
    @Transactional(readOnly = true)
    public Map<String, List<EffectiveSlot>> effectiveSlots(Collection<Commission> list) {
        if (list.isEmpty()) return Map.of();
        var ids = list.stream().map(Commission::getId).collect(Collectors.toSet());
        Map<String, ScheduleCorrection> applied = corrections
            .findByCommissionIdInAndStatusIn(ids, EnumSet.of(APPLIED)).stream()
            .collect(Collectors.toMap(ScheduleCorrection::getCommissionId, Function.identity(), (a, b) -> a));
        var out = new LinkedHashMap<String, List<EffectiveSlot>>();
        for (var commission : list) {
            var sga = CorrectionSlots.sga(commission.getTimes());
            var c = applied.get(commission.getId());
            out.put(commission.getId(), c != null ? CorrectionSlots.withRooms(c.getProposedSlots(), sga) : sga);
        }
        return out;
    }

    // APPLIED first, then most confirmed, then oldest.
    private static final Comparator<ScheduleCorrection> PUBLIC_ORDER = Comparator
        .comparing((ScheduleCorrection c) -> c.getStatus() == APPLIED ? 0 : 1)
        .thenComparing(ScheduleCorrection::getConfirmCount, Comparator.reverseOrder())
        .thenComparing(ScheduleCorrection::getCreatedAt, Comparator.nullsLast(Comparator.naturalOrder()))
        .thenComparing(ScheduleCorrection::getId);

    // ---- Transitions -----------------------------------------------------

    private void recount(ScheduleCorrection c) {
        int confirms = (int) votes.countByCorrectionIdAndType(c.getId(), ScheduleCorrectionVoteType.CONFIRM);
        int rejects = (int) votes.countByCorrectionIdAndType(c.getId(), ScheduleCorrectionVoteType.REJECT);
        c.setCounts(confirms, rejects);
    }

    private void recountAndEvaluate(ScheduleCorrection c, Commission commission) {
        recount(c);
        int confirms = c.getConfirmCount();
        int rejects = c.getRejectCount();
        boolean meetsRule = confirms >= APPLY_THRESHOLD && confirms > rejects;
        if (c.getStatus() == PENDING && meetsRule) {
            apply(c, commission);
        } else if (c.getStatus() == APPLIED && !meetsRule && !c.isReviewedByStaff()) {
            c.setStatus(PENDING);
        }
    }

    // Makes `c` the commission's applied correction. The previous one is
    // superseded and flushed first, so the one-applied unique index never
    // sees two. The suggester is notified the first time only.
    private void apply(ScheduleCorrection c, Commission commission) {
        for (var previous : corrections.findByCommissionIdAndStatusIn(c.getCommissionId(), EnumSet.of(APPLIED))) {
            if (previous.getId().equals(c.getId())) continue;
            previous.setStatus(SUPERSEDED);
        }
        corrections.flush();
        c.setStatus(APPLIED);
        if (c.getAppliedAt() == null) {
            c.setAppliedAt(OffsetDateTime.now(clock));
            notifyApplied(c, commission);
        }
    }

    // Push to the suggester's devices, sent by PushTriggerListener after
    // commit (a rolled-back apply sends nothing).
    private void notifyApplied(ScheduleCorrection c, Commission commission) {
        if (c.getSuggesterId() == null) return;
        String subjectName = subjects.findById(commission.getSubjectCode())
            .map(Subject::getName)
            .orElse(commission.getSubjectCode());
        String body = subjectName + " · Comisión " + commission.getCommissionName()
            + ": el horario corregido ya se usa en el Combinador.";
        events.publishEvent(new PushToUsers(Set.of(c.getSuggesterId()), new PushMessage(PUSH_TITLE, body, Map.of(
            PushMessage.TYPE, PUSH_TYPE,
            "correctionId", c.getId().toString(),
            "subjectId", commission.getSubjectCode(),
            "commissionId", commission.getId()))));
    }

    // ---- Helpers ---------------------------------------------------------

    private record Locked(ScheduleCorrection correction, Commission commission) {}

    // Locks the parent commission, then loads the correction fresh (it was
    // never in this persistence context before the lock).
    private Locked lock(UUID correctionId) {
        String commissionId = corrections.findCommissionIdById(correctionId)
            .orElseThrow(() -> new ResourceNotFoundException("ScheduleCorrection", correctionId.toString()));
        Commission commission = commissions.findForUpdate(commissionId)
            .orElseThrow(() -> new ResourceNotFoundException("ScheduleCorrection", correctionId.toString()));
        var c = corrections.findById(correctionId)
            .orElseThrow(() -> new ResourceNotFoundException("ScheduleCorrection", correctionId.toString()));
        return new Locked(c, commission);
    }

    private static void requireOpen(ScheduleCorrection c) {
        if (!c.getStatus().isOpen()) {
            throw new InvalidStateException("Schedule correction is " + c.getStatus());
        }
    }

    private void requireVotable(ScheduleCorrection c, Commission commission) {
        requireOpen(c);
        requireNotEnded(commission);
    }

    private void requireNotEnded(Commission commission) {
        if (commission.getCourseEnd().isBefore(LocalDate.now(clock))) {
            throw new ScheduleCorrectionException(ScheduleCorrectionException.Reason.COMMISSION_ENDED,
                "Commission " + commission.getId() + " has ended");
        }
    }

    private ScheduleCorrectionVoteType myVote(UUID correctionId, UUID userId) {
        return votes.findById(new ScheduleCorrectionVoteId(correctionId, userId))
            .map(ScheduleCorrectionVote::getType)
            .orElse(null);
    }

    private Map<UUID, ScheduleCorrectionVoteType> myVotes(UUID userId, List<ScheduleCorrection> list) {
        if (list.isEmpty()) return Map.of();
        var ids = list.stream().map(ScheduleCorrection::getId).toList();
        return votes.findByUserIdAndCorrectionIdIn(userId, ids).stream()
            .collect(Collectors.toMap(ScheduleCorrectionVote::getCorrectionId, ScheduleCorrectionVote::getType));
    }

    private static CorrectionResponse toResponse(ScheduleCorrection c, Commission commission,
                                                 ScheduleCorrectionVoteType myVote) {
        var sga = commission != null ? CorrectionSlots.sga(commission.getTimes()) : List.<EffectiveSlot>of();
        return new CorrectionResponse(
            c.getId(),
            c.getCommissionId(),
            c.getStatus(),
            CorrectionSlots.toSchedule(CorrectionSlots.withRooms(c.getProposedSlots(), sga)),
            c.getConfirmCount(),
            c.getRejectCount(),
            myVote,
            instant(c.getCreatedAt()));
    }

    private record Context(Map<String, Commission> commissions, Map<String, String> subjectNames) {
        String subjectName(String subjectId) {
            return subjectId == null ? null : subjectNames.get(subjectId);
        }
    }

    // Commissions (with times) and subject names of a batch, in two queries.
    private Context context(List<ScheduleCorrection> list) {
        if (list.isEmpty()) return new Context(Map.of(), Map.of());
        var ids = list.stream().map(ScheduleCorrection::getCommissionId).collect(Collectors.toSet());
        Map<String, Commission> byId = commissions.findByIdInWithTimes(ids).stream()
            .collect(Collectors.toMap(Commission::getId, Function.identity()));
        var codes = byId.values().stream().map(Commission::getSubjectCode).collect(Collectors.toSet());
        Map<String, String> names = subjects.findAllById(codes).stream()
            .collect(Collectors.toMap(Subject::getId, Subject::getName));
        return new Context(byId, names);
    }

    private static StaffCorrectionResponse toStaffResponse(ScheduleCorrection c, Context ctx) {
        var commission = ctx.commissions().get(c.getCommissionId());
        var sga = commission != null ? CorrectionSlots.sga(commission.getTimes()) : List.<EffectiveSlot>of();
        String subjectId = commission != null ? commission.getSubjectCode() : null;
        return new StaffCorrectionResponse(
            c.getId(),
            c.getCommissionId(),
            c.getStatus(),
            CorrectionSlots.toSchedule(CorrectionSlots.withRooms(c.getProposedSlots(), sga)),
            c.getConfirmCount(),
            c.getRejectCount(),
            instant(c.getCreatedAt()),
            subjectId,
            ctx.subjectName(subjectId),
            commission != null ? commission.getCommissionName() : null,
            CorrectionSlots.toSchedule(sga),
            instant(c.getAppliedAt()),
            instant(c.getReviewedAt()),
            c.isReviewedByStaff());
    }

    private static Instant instant(OffsetDateTime t) {
        return t == null ? null : t.toInstant();
    }
}
