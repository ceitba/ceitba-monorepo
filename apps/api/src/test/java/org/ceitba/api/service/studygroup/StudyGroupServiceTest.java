package org.ceitba.api.service.studygroup;

import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.common.exception.ValidationException;
import org.ceitba.api.domain.StudyGroup;
import org.ceitba.api.domain.StudyGroupLocation;
import org.ceitba.api.domain.StudyGroupParticipant;
import org.ceitba.api.domain.StudyGroupType;
import org.ceitba.api.domain.Subject;
import org.ceitba.api.domain.User;
import org.ceitba.api.repository.StudyGroupParticipantRepository;
import org.ceitba.api.repository.StudyGroupRepository;
import org.ceitba.api.repository.SubjectRepository;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.service.studygroup.StudyGroupConflictException.Reason;
import org.ceitba.api.service.studygroup.StudyGroupService.LeaveOutcome;
import org.ceitba.api.web.studygroup.dto.CreateStudyGroupRequest;
import org.ceitba.api.web.studygroup.dto.UpdateStudyGroupRequest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyIterable;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class StudyGroupServiceTest {

    private static final Instant NOW = Instant.parse("2026-05-10T15:00:00Z");
    private static final OffsetDateTime NOW_ODT = NOW.atOffset(ZoneOffset.UTC);
    private static final String SUBJECT = "93.41";

    private final UUID owner = UUID.randomUUID();
    private final UUID alice = UUID.randomUUID();
    private final UUID bob = UUID.randomUUID();

    private StudyGroupRepository groups;
    private StudyGroupParticipantRepository participants;
    private SubjectRepository subjects;
    private UserRepository users;
    private StudyGroupService service;

    @BeforeEach
    void setUp() {
        groups = mock(StudyGroupRepository.class);
        participants = mock(StudyGroupParticipantRepository.class);
        subjects = mock(SubjectRepository.class);
        users = mock(UserRepository.class);
        service = new StudyGroupService(groups, participants, subjects, users,
                                        Clock.fixed(NOW, ZoneOffset.UTC));

        when(subjects.existsById(SUBJECT)).thenReturn(true);
        when(subjects.findAllById(anyIterable())).thenReturn(List.of(new Subject(SUBJECT, "Algebra", 9)));
        when(groups.save(any(StudyGroup.class))).thenAnswer(inv -> withId(inv.getArgument(0)));
        when(groups.saveAndFlush(any(StudyGroup.class))).thenAnswer(inv -> inv.getArgument(0));
        when(users.findAllById(anyIterable())).thenReturn(List.of());
    }

    private static StudyGroup withId(StudyGroup g) {
        if (g.getId() == null) ReflectionTestUtils.setField(g, "id", UUID.randomUUID());
        return g;
    }

    private StudyGroup group(Integer max, OffsetDateTime dueAt) {
        var g = withId(new StudyGroup(owner, "Parcial", SUBJECT, StudyGroupType.EXAMEN,
                                      List.of(StudyGroupLocation.SDF), dueAt));
        g.setMaxParticipants(max);
        g.setContactLink("https://chat.example.org/abc");
        when(groups.findById(g.getId())).thenReturn(Optional.of(g));
        when(groups.findByIdForUpdate(g.getId())).thenReturn(Optional.of(g));
        return g;
    }

    private List<StudyGroupParticipant> members(StudyGroup g, UUID... userIds) {
        var list = new ArrayList<StudyGroupParticipant>();
        for (int i = 0; i < userIds.length; i++) {
            list.add(new StudyGroupParticipant(g.getId(), userIds[i], NOW_ODT.minusDays(10).plusHours(i)));
        }
        when(participants.findByGroupIdOrderByJoinedAtAscUserIdAsc(g.getId())).thenReturn(list);
        when(participants.countByGroupId(g.getId())).thenReturn((long) list.size());
        for (var id : userIds) when(participants.existsByGroupIdAndUserId(g.getId(), id)).thenReturn(true);
        return list;
    }

    private static CreateStudyGroupRequest createReq(OffsetDateTime dueAt, Integer max) {
        return new CreateStudyGroupRequest("  Parcial  ", SUBJECT, StudyGroupType.EXAMEN,
            List.of(StudyGroupLocation.SDF, StudyGroupLocation.SDF, StudyGroupLocation.VIRTUAL),
            dueAt, " ", "https://chat.example.org/abc", max);
    }

    private static UpdateStudyGroupRequest patch(Integer max) {
        return new UpdateStudyGroupRequest(null, null, null, null, null, null, null, max);
    }

    // --- create ---------------------------------------------------------------

    @Test
    void createMakesTheCreatorOwnerAndFirstParticipant() {
        var res = service.create(owner, createReq(NOW_ODT.plusDays(1), 0));

        var saved = ArgumentCaptor.forClass(StudyGroupParticipant.class);
        verify(participants).save(saved.capture());
        assertThat(saved.getValue().getUserId()).isEqualTo(owner);
        assertThat(saved.getValue().getJoinedAt()).isEqualTo(NOW_ODT);

        assertThat(res.title()).isEqualTo("Parcial");
        assertThat(res.maxParticipants()).isNull(); // 0 = unlimited
        assertThat(res.description()).isNull();     // blank = none
        assertThat(res.locations()).containsExactly(StudyGroupLocation.SDF, StudyGroupLocation.VIRTUAL);
        assertThat(res.isOwner()).isTrue();
        assertThat(res.canEdit()).isTrue();
        assertThat(res.subject().name()).isEqualTo("Algebra");
    }

    @Test
    void createRejectsUnknownSubject() {
        var req = new CreateStudyGroupRequest("t", "XX.99", StudyGroupType.GUIAS,
            List.of(StudyGroupLocation.SDR), NOW_ODT.plusDays(1), null, null, null);
        assertThatThrownBy(() -> service.create(owner, req)).isInstanceOf(ValidationException.class)
            .hasMessageContaining("subjectId");
        verify(groups, never()).save(any());
    }

    @Test
    void createRejectsDueDateNotInTheFuture() {
        assertThatThrownBy(() -> service.create(owner, createReq(NOW_ODT, null)))
            .isInstanceOf(ValidationException.class).hasMessageContaining("dueAt");
    }

    @Test
    void createRejectsCapacityOfOne() {
        assertThatThrownBy(() -> service.create(owner, createReq(NOW_ODT.plusDays(1), 1)))
            .isInstanceOf(ValidationException.class).hasMessageContaining("maxParticipants");
    }

    // --- join -----------------------------------------------------------------

    @Test
    void joinAddsTheCallerWithClockTime() {
        var g = group(3, NOW_ODT.plusDays(1));
        members(g, owner);

        service.join(alice, false, g.getId());

        var saved = ArgumentCaptor.forClass(StudyGroupParticipant.class);
        verify(participants).saveAndFlush(saved.capture());
        assertThat(saved.getValue().getUserId()).isEqualTo(alice);
        assertThat(saved.getValue().getJoinedAt()).isEqualTo(NOW_ODT);
        verify(groups).findByIdForUpdate(g.getId());
    }

    @Test
    void joinFullGroupIsConflict() {
        var g = group(2, NOW_ODT.plusDays(1));
        members(g, owner, bob);

        assertThatThrownBy(() -> service.join(alice, false, g.getId()))
            .isInstanceOf(StudyGroupConflictException.class)
            .extracting(e -> ((StudyGroupConflictException) e).reason()).isEqualTo(Reason.FULL);
        verify(participants, never()).saveAndFlush(any());
    }

    @Test
    void joinPastDueGroupIsConflict() {
        var g = group(null, NOW_ODT); // due exactly now counts as past due
        members(g, owner);

        assertThatThrownBy(() -> service.join(alice, false, g.getId()))
            .isInstanceOf(StudyGroupConflictException.class)
            .extracting(e -> ((StudyGroupConflictException) e).reason()).isEqualTo(Reason.PAST_DUE);
    }

    @Test
    void joinUnlimitedGroupNeverChecksCapacity() {
        var g = group(null, NOW_ODT.plusDays(1));
        members(g, owner, bob);

        service.join(alice, false, g.getId());
        verify(participants).saveAndFlush(any());
        verify(participants, never()).countByGroupId(g.getId());
    }

    @Test
    void joinWhenAlreadyMemberIsNoOp() {
        var g = group(2, NOW_ODT.minusDays(1)); // even if full and past due
        members(g, owner, alice);

        var res = service.join(alice, false, g.getId());
        verify(participants, never()).saveAndFlush(any());
        assertThat(res.isMember()).isTrue();
    }

    @Test
    void joinUnknownGroupIsNotFound() {
        var id = UUID.randomUUID();
        when(groups.findByIdForUpdate(id)).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.join(alice, false, id)).isInstanceOf(ResourceNotFoundException.class);
    }

    // --- leave ----------------------------------------------------------------

    @Test
    void memberLeaves() {
        var g = group(null, NOW_ODT.plusDays(1));
        var list = members(g, owner, alice);

        assertThat(service.leave(alice, g.getId())).isEqualTo(LeaveOutcome.LEFT);
        verify(participants).delete(list.get(1));
        assertThat(g.getOwnerId()).isEqualTo(owner);
    }

    @Test
    void leavingWhenNotAMemberIsNotFound() {
        var g = group(null, NOW_ODT.plusDays(1));
        members(g, owner);
        assertThatThrownBy(() -> service.leave(alice, g.getId())).isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void ownerLeavingAloneDeletesTheGroup() {
        var g = group(null, NOW_ODT.plusDays(1));
        members(g, owner);

        assertThat(service.leave(owner, g.getId())).isEqualTo(LeaveOutcome.GROUP_DELETED);
        verify(groups).delete(g);
    }

    @Test
    void ownerLeavingTransfersToEarliestJoiner() {
        var g = group(null, NOW_ODT.plusDays(1));
        var list = members(g, owner, bob, alice); // bob joined before alice

        assertThat(service.leave(owner, g.getId())).isEqualTo(LeaveOutcome.OWNERSHIP_TRANSFERRED);
        assertThat(g.getOwnerId()).isEqualTo(bob);
        verify(participants).delete(list.get(0));
        verify(groups, never()).delete(any(StudyGroup.class));
    }

    // --- update / delete ------------------------------------------------------

    @Test
    void strangerCannotEditOrDelete() {
        var g = group(null, NOW_ODT.plusDays(1));
        members(g, owner);

        assertThatThrownBy(() -> service.update(alice, false, g.getId(), patch(5)))
            .isInstanceOf(StudyGroupForbiddenException.class);
        assertThatThrownBy(() -> service.delete(alice, false, g.getId()))
            .isInstanceOf(StudyGroupForbiddenException.class);
        verify(groups, never()).delete(any(StudyGroup.class));
    }

    @Test
    void moderatorCanEditAndDelete() {
        var g = group(null, NOW_ODT.plusDays(1));
        members(g, owner);

        var res = service.update(alice, true, g.getId(),
            new UpdateStudyGroupRequest("Nuevo", null, StudyGroupType.GUIAS, null, null, "", "  ", null));
        assertThat(res.title()).isEqualTo("Nuevo");
        assertThat(res.type()).isEqualTo(StudyGroupType.GUIAS);
        assertThat(res.canEdit()).isTrue();
        assertThat(res.isOwner()).isFalse();
        assertThat(g.getContactLink()).isNull(); // blank clears

        service.delete(alice, true, g.getId());
        verify(groups).delete(g);
    }

    @Test
    void capacityCannotDropBelowMembers() {
        var g = group(null, NOW_ODT.plusDays(1));
        members(g, owner, alice, bob);

        assertThatThrownBy(() -> service.update(owner, false, g.getId(), patch(2)))
            .isInstanceOf(StudyGroupConflictException.class)
            .extracting(e -> ((StudyGroupConflictException) e).reason())
            .isEqualTo(Reason.CAPACITY_BELOW_MEMBERS);

        assertThat(service.update(owner, false, g.getId(), patch(3)).maxParticipants()).isEqualTo(3);
        assertThat(service.update(owner, false, g.getId(), patch(0)).maxParticipants()).isNull();
    }

    @Test
    void updateRejectsBlankTitleAndPastDueDate() {
        var g = group(null, NOW_ODT.plusDays(1));
        members(g, owner);

        assertThatThrownBy(() -> service.update(owner, false, g.getId(),
                new UpdateStudyGroupRequest("   ", null, null, null, null, null, null, null)))
            .isInstanceOf(ValidationException.class);
        assertThatThrownBy(() -> service.update(owner, false, g.getId(),
                new UpdateStudyGroupRequest(null, null, null, null, NOW_ODT.minusMinutes(1), null, null, null)))
            .isInstanceOf(ValidationException.class);
    }

    // --- views ----------------------------------------------------------------

    @Test
    void contactLinkIsMembersOnly() {
        var g = group(2, NOW_ODT.plusDays(1));
        members(g, owner, bob);

        var stranger = service.get(alice, false, g.getId());
        assertThat(stranger.contactLink()).isNull();
        assertThat(stranger.isMember()).isFalse();
        assertThat(stranger.isFull()).isTrue();
        assertThat(stranger.canEdit()).isFalse();

        assertThat(service.get(bob, false, g.getId()).contactLink()).isEqualTo("https://chat.example.org/abc");
        // Moderators can edit but still don't see the link unless they joined.
        var mod = service.get(alice, true, g.getId());
        assertThat(mod.canEdit()).isTrue();
        assertThat(mod.contactLink()).isNull();
    }

    @Test
    void participantsExposeNameAndAvatarOnly() {
        var g = group(null, NOW_ODT.plusDays(1));
        members(g, owner, bob);
        var ownerUser = new User(owner, "owner@itba.edu.ar", "Olivia");
        ownerUser.setAvatarUrl("https://img.example.org/o.png");
        when(users.findAllById(anyIterable())).thenReturn(List.of(ownerUser, new User(bob, "bob@itba.edu.ar", "Bob")));

        var res = service.get(bob, false, g.getId());
        assertThat(res.participants()).hasSize(2);
        assertThat(res.participants().get(0).name()).isEqualTo("Olivia");
        assertThat(res.participants().get(0).avatarUrl()).isEqualTo("https://img.example.org/o.png");
        assertThat(res.participants().get(0).isOwner()).isTrue();
        assertThat(res.participants().get(1).isOwner()).isFalse();
        assertThat(res.participants().toString()).doesNotContain("@itba.edu.ar");
    }

    @Test
    void listPageUsesBatchedCountsAndMembership() {
        var a = group(2, NOW_ODT.plusDays(1));
        var b = group(null, NOW_ODT.plusDays(2));
        when(groups.findAll(any(org.springframework.data.jpa.domain.Specification.class),
                            any(org.springframework.data.domain.Pageable.class)))
            .thenReturn(new org.springframework.data.domain.PageImpl<>(List.of(a, b)));
        when(participants.countByGroupIds(anyCollection()))
            .thenReturn(List.of(new Object[] {a.getId(), 2L}, new Object[] {b.getId(), 1L}));
        when(participants.findJoinedGroupIds(any(), anyCollection())).thenReturn(List.of(b.getId()));

        var page = service.list(alice, false, null, null, true, 1, 500).getContent();
        assertThat(page).hasSize(2);
        assertThat(page.get(0).isFull()).isTrue();
        assertThat(page.get(0).isMember()).isFalse();
        assertThat(page.get(0).contactLink()).isNull();
        assertThat(page.get(0).participants()).isNull();
        assertThat(page.get(1).participantCount()).isEqualTo(1);
        assertThat(page.get(1).isMember()).isTrue();
        assertThat(page.get(1).contactLink()).isNotNull();
        verify(participants, never()).findByGroupIdOrderByJoinedAtAscUserIdAsc(any());
    }
}
