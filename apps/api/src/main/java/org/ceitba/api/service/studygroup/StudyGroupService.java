package org.ceitba.api.service.studygroup;

import jakarta.persistence.criteria.Predicate;
import jakarta.persistence.criteria.Subquery;
import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.common.exception.ValidationException;
import org.ceitba.api.domain.StudyGroup;
import org.ceitba.api.domain.StudyGroupParticipant;
import org.ceitba.api.domain.StudyGroupType;
import org.ceitba.api.domain.Subject;
import org.ceitba.api.domain.User;
import org.ceitba.api.repository.StudyGroupParticipantRepository;
import org.ceitba.api.repository.StudyGroupRepository;
import org.ceitba.api.repository.SubjectRepository;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.service.studygroup.StudyGroupConflictException.Reason;
import org.ceitba.api.web.studygroup.dto.CreateStudyGroupRequest;
import org.ceitba.api.web.studygroup.dto.StudyGroupParticipantResponse;
import org.ceitba.api.web.studygroup.dto.StudyGroupResponse;
import org.ceitba.api.web.studygroup.dto.StudyGroupSubjectResponse;
import org.ceitba.api.web.studygroup.dto.UpdateStudyGroupRequest;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

// Student study groups (V24).
//
// Membership rules:
// * The creator is the owner and its first participant.
// * Join is refused (409) when the group is past due or full. Capacity
//   (maxParticipants, owner included; null = unlimited) is checked under a
//   pessimistic lock on the group row, so concurrent joins can't overshoot.
//   Joining a group you're already in is a no-op.
// * Leave: a regular member is removed. When the owner leaves, the group is
//   deleted if they were its only member; otherwise ownership passes to the
//   earliest remaining joiner (ties broken by user id).
// * Edit/delete: owner or MODERATOR (active STAFF implies MODERATOR).
//
// Privacy: participants are exposed as name + avatar only, and contactLink
// only to members.
//
// "Upcoming" means dueAt is after now, with now from the injected Clock.
@Service
public class StudyGroupService {

    public static final int MAX_PAGE_SIZE = 100;
    public static final int MIN_CAPACITY = 2;

    private static final Sort LIST_ORDER = Sort.by(Sort.Order.asc("dueAt"), Sort.Order.asc("id"));

    private final StudyGroupRepository groups;
    private final StudyGroupParticipantRepository participants;
    private final SubjectRepository subjects;
    private final UserRepository users;
    private final Clock clock;

    public StudyGroupService(StudyGroupRepository groups,
                             StudyGroupParticipantRepository participants,
                             SubjectRepository subjects,
                             UserRepository users,
                             Clock clock) {
        this.groups = groups;
        this.participants = participants;
        this.subjects = subjects;
        this.users = users;
        this.clock = clock;
    }

    // --- Reads ----------------------------------------------------------------

    @Transactional(readOnly = true)
    public Page<StudyGroupResponse> list(UUID viewerId, boolean moderator, String subjectId,
                                         StudyGroupType type, boolean upcomingOnly,
                                         int page, int limit) {
        var pageable = PageRequest.of(Math.max(page - 1, 0),
                                      Math.min(Math.max(limit, 1), MAX_PAGE_SIZE), LIST_ORDER);
        Specification<StudyGroup> spec = filters(subjectId, type, upcomingOnly, null);
        Page<StudyGroup> result = groups.findAll(spec, pageable);
        var rendered = summaries(result.getContent(), viewerId, moderator);
        return result.map(g -> rendered.get(g.getId()));
    }

    // The caller's groups (owned or joined), soonest due first.
    @Transactional(readOnly = true)
    public List<StudyGroupResponse> listMine(UUID viewerId, boolean moderator, boolean upcomingOnly) {
        var mine = groups.findAll(filters(null, null, upcomingOnly, viewerId), LIST_ORDER);
        var rendered = summaries(mine, viewerId, moderator);
        return mine.stream().map(g -> rendered.get(g.getId())).toList();
    }

    @Transactional(readOnly = true)
    public StudyGroupResponse get(UUID viewerId, boolean moderator, UUID id) {
        return detail(find(id), viewerId, moderator);
    }

    // --- Writes ---------------------------------------------------------------

    @Transactional
    public StudyGroupResponse create(UUID ownerId, CreateStudyGroupRequest req) {
        var now = now();
        requireSubject(req.subjectId());
        requireFuture(req.dueAt(), now);
        var group = new StudyGroup(ownerId, req.title().trim(), req.subjectId(), req.type(),
                                   req.locations(), req.dueAt());
        group.setDescription(blankToNull(req.description()));
        group.setContactLink(blankToNull(req.contactLink()));
        group.setMaxParticipants(capacity(req.maxParticipants()));
        group = groups.save(group);
        participants.save(new StudyGroupParticipant(group.getId(), ownerId, now));
        return detail(group, ownerId, false);
    }

    @Transactional
    public StudyGroupResponse update(UUID userId, boolean moderator, UUID id, UpdateStudyGroupRequest req) {
        // Locked: a capacity change must see a member count no join can race.
        var group = findForUpdate(id);
        requireCanEdit(group, userId, moderator, "edit");

        if (req.title() != null) {
            if (req.title().isBlank()) throw new ValidationException("title", req.title(), "must not be blank");
            group.setTitle(req.title().trim());
        }
        if (req.subjectId() != null) {
            requireSubject(req.subjectId());
            group.setSubjectId(req.subjectId());
        }
        if (req.type() != null) group.setType(req.type());
        if (req.locations() != null) group.setLocations(req.locations());
        if (req.dueAt() != null) {
            requireFuture(req.dueAt(), now());
            group.setDueAt(req.dueAt());
        }
        if (req.description() != null) group.setDescription(blankToNull(req.description()));
        if (req.contactLink() != null) group.setContactLink(blankToNull(req.contactLink()));
        if (req.maxParticipants() != null) {
            Integer max = capacity(req.maxParticipants());
            long members = participants.countByGroupId(id);
            if (max != null && max < members) {
                throw new StudyGroupConflictException(Reason.CAPACITY_BELOW_MEMBERS,
                    "Group already has " + members + " members; capacity can't be set to " + max);
            }
            group.setMaxParticipants(max);
        }
        return detail(groups.saveAndFlush(group), userId, moderator);
    }

    @Transactional
    public void delete(UUID userId, boolean moderator, UUID id) {
        var group = findForUpdate(id);
        requireCanEdit(group, userId, moderator, "delete");
        groups.delete(group); // participants go with it (ON DELETE CASCADE)
    }

    @Transactional
    public StudyGroupResponse join(UUID userId, boolean moderator, UUID id) {
        var group = findForUpdate(id);
        if (!participants.existsByGroupIdAndUserId(id, userId)) {
            var now = now();
            if (group.isPastDue(now)) {
                throw new StudyGroupConflictException(Reason.PAST_DUE, "Study group is past its due date");
            }
            Integer max = group.getMaxParticipants();
            if (max != null && participants.countByGroupId(id) >= max) {
                throw new StudyGroupConflictException(Reason.FULL, "Study group is full");
            }
            participants.saveAndFlush(new StudyGroupParticipant(id, userId, now));
        }
        return detail(group, userId, moderator);
    }

    // Removes the caller from the group (404 if not a member). An owner who
    // leaves hands the group to the earliest remaining joiner, or deletes it
    // when nobody else is left. The outcome is reported for logging/tests.
    @Transactional
    public LeaveOutcome leave(UUID userId, UUID id) {
        var group = findForUpdate(id);
        var members = participants.findByGroupIdOrderByJoinedAtAscUserIdAsc(id);
        var me = members.stream().filter(p -> p.getUserId().equals(userId)).findFirst()
            .orElseThrow(() -> new ResourceNotFoundException("StudyGroupMembership", id.toString()));

        if (!group.isOwnedBy(userId)) {
            participants.delete(me);
            return LeaveOutcome.LEFT;
        }
        var successor = members.stream().filter(p -> !p.getUserId().equals(userId)).findFirst();
        if (successor.isEmpty()) {
            groups.delete(group);
            return LeaveOutcome.GROUP_DELETED;
        }
        participants.delete(me);
        group.setOwnerId(successor.get().getUserId());
        groups.save(group);
        return LeaveOutcome.OWNERSHIP_TRANSFERRED;
    }

    public enum LeaveOutcome { LEFT, OWNERSHIP_TRANSFERRED, GROUP_DELETED }

    // --- Helpers --------------------------------------------------------------

    private OffsetDateTime now() {
        return OffsetDateTime.now(clock);
    }

    private StudyGroup find(UUID id) {
        return groups.findById(id)
            .orElseThrow(() -> new ResourceNotFoundException("StudyGroup", id.toString()));
    }

    private StudyGroup findForUpdate(UUID id) {
        return groups.findByIdForUpdate(id)
            .orElseThrow(() -> new ResourceNotFoundException("StudyGroup", id.toString()));
    }

    private static void requireCanEdit(StudyGroup group, UUID userId, boolean moderator, String action) {
        if (!moderator && !group.isOwnedBy(userId)) throw new StudyGroupForbiddenException(action);
    }

    private void requireSubject(String subjectId) {
        if (!subjects.existsById(subjectId)) {
            throw new ValidationException("subjectId", subjectId, "unknown subject");
        }
    }

    private static void requireFuture(OffsetDateTime dueAt, OffsetDateTime now) {
        if (!dueAt.isAfter(now)) throw new ValidationException("dueAt", dueAt, "must be in the future");
    }

    // 0 / null = unlimited (stored as NULL); otherwise at least the owner plus one.
    private static Integer capacity(Integer requested) {
        if (requested == null || requested == 0) return null;
        if (requested < MIN_CAPACITY) {
            throw new ValidationException("maxParticipants", requested,
                "must be 0 (unlimited) or at least " + MIN_CAPACITY);
        }
        return requested;
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    private Specification<StudyGroup> filters(String subjectId, StudyGroupType type,
                                              boolean upcomingOnly, UUID memberId) {
        var now = now();
        return (root, query, cb) -> {
            List<Predicate> where = new ArrayList<>();
            if (subjectId != null && !subjectId.isBlank()) where.add(cb.equal(root.get("subjectId"), subjectId));
            if (type != null) where.add(cb.equal(root.get("type"), type));
            if (upcomingOnly) where.add(cb.greaterThan(root.get("dueAt"), now));
            if (memberId != null) {
                Subquery<UUID> joined = query.subquery(UUID.class);
                var p = joined.from(StudyGroupParticipant.class);
                joined.select(p.get("groupId")).where(cb.equal(p.get("userId"), memberId));
                where.add(root.get("id").in(joined));
            }
            return cb.and(where.toArray(Predicate[]::new));
        };
    }

    // List rendering: three batched queries (counts, membership, subjects)
    // regardless of page size. No participants, no N+1.
    private Map<UUID, StudyGroupResponse> summaries(List<StudyGroup> page, UUID viewerId, boolean moderator) {
        if (page.isEmpty()) return Map.of();
        var ids = page.stream().map(StudyGroup::getId).toList();
        Map<UUID, Long> counts = new HashMap<>();
        for (Object[] row : participants.countByGroupIds(ids)) counts.put((UUID) row[0], (Long) row[1]);
        Set<UUID> joined = new HashSet<>(participants.findJoinedGroupIds(viewerId, ids));
        var subjectNames = subjectNames(page.stream().map(StudyGroup::getSubjectId).collect(Collectors.toSet()));

        Map<UUID, StudyGroupResponse> out = new HashMap<>();
        for (var g : page) {
            out.put(g.getId(), toResponse(g, viewerId, moderator, counts.getOrDefault(g.getId(), 0L),
                                          joined.contains(g.getId()), subjectNames, null));
        }
        return out;
    }

    private StudyGroupResponse detail(StudyGroup g, UUID viewerId, boolean moderator) {
        var members = participants.findByGroupIdOrderByJoinedAtAscUserIdAsc(g.getId());
        Map<UUID, User> byId = users.findAllById(members.stream().map(StudyGroupParticipant::getUserId).toList())
            .stream().collect(Collectors.toMap(User::getId, Function.identity()));
        var views = members.stream()
            .map(p -> {
                var u = byId.get(p.getUserId());
                return new StudyGroupParticipantResponse(
                    u != null ? u.getName() : null,
                    u != null ? u.getAvatarUrl() : null,
                    g.isOwnedBy(p.getUserId()),
                    p.getJoinedAt());
            })
            .toList();
        boolean member = members.stream().anyMatch(p -> p.getUserId().equals(viewerId));
        return toResponse(g, viewerId, moderator, members.size(), member,
                          subjectNames(Set.of(g.getSubjectId())), views);
    }

    private Map<String, String> subjectNames(Set<String> ids) {
        return subjects.findAllById(ids).stream()
            .collect(Collectors.toMap(Subject::getId, Subject::getName));
    }

    private static StudyGroupResponse toResponse(StudyGroup g, UUID viewerId, boolean moderator,
                                                 long count, boolean member, Map<String, String> subjectNames,
                                                 List<StudyGroupParticipantResponse> participantViews) {
        boolean owner = g.isOwnedBy(viewerId);
        Integer max = g.getMaxParticipants();
        return new StudyGroupResponse(
            g.getId(),
            g.getTitle(),
            new StudyGroupSubjectResponse(g.getSubjectId(), subjectNames.get(g.getSubjectId())),
            g.getType(),
            g.getLocations(),
            g.getDueAt(),
            g.getDescription(),
            member ? g.getContactLink() : null,
            max,
            count,
            max != null && count >= max,
            member,
            owner,
            owner || moderator,
            participantViews,
            g.getCreatedAt(),
            g.getUpdatedAt());
    }
}
