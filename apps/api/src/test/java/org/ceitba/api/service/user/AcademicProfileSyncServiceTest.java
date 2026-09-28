package org.ceitba.api.service.user;

import org.ceitba.api.common.exception.ExternalApiException;
import org.ceitba.api.domain.Career;
import org.ceitba.api.domain.Plan;
import org.ceitba.api.domain.User;
import org.ceitba.api.external.itba.FakeItbaApiClient;
import org.ceitba.api.external.itba.StudentProjection;
import org.ceitba.api.repository.CareerRepository;
import org.ceitba.api.repository.PlanRepository;
import org.ceitba.api.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.PlatformTransactionManager;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.Executor;
import java.util.concurrent.RejectedExecutionException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

// AcademicProfileSyncService against FakeItbaApiClient with in-memory
// repositories (Mockito) and a same-thread executor.
class AcademicProfileSyncServiceTest {

    private static final String EMAIL = "student@itba.edu.ar";

    private final Career careerS = new Career("S", "Ingeniería en Informática");
    private final Career careerI = new Career("I", "Ingeniería Industrial");
    private final Map<String, Career> careerTable = Map.of("S", careerS, "I", careerI);
    private final List<Plan> sPlans = List.of(
        new Plan("S10-Rev23", careerS, "S10-Rev23"),
        new Plan("S10 A - Rev18", careerS, "S10 A - Rev18"));

    private FakeItbaApiClient itba;
    private UserRepository users;
    private User user;
    private final Map<UUID, User> rows = new HashMap<>();
    private AcademicProfileSyncService service;

    @BeforeEach
    void setup() {
        itba = new FakeItbaApiClient();
        users = mock(UserRepository.class);
        var careers = mock(CareerRepository.class);
        var plans = mock(PlanRepository.class);
        user = new User(UUID.randomUUID(), EMAIL, "Student");

        when(users.findById(any())).thenAnswer(inv -> Optional.ofNullable(rows.get(inv.<UUID>getArgument(0))));
        rows.put(user.getId(), user);
        when(users.findByFileNumber(anyInt())).thenReturn(Optional.empty());
        // Emulate the conditional UPDATEs on the in-memory rows.
        when(users.fillFileNumberIfNull(any(), any(), any())).thenAnswer(inv -> {
            var u = rows.get(inv.<UUID>getArgument(0));
            if (u == null || u.getFileNumber() != null) return 0;
            u.setFileNumber(inv.getArgument(1));
            return 1;
        });
        when(users.fillCareerIfNull(any(), any(), any())).thenAnswer(inv -> {
            var u = rows.get(inv.<UUID>getArgument(0));
            if (u == null || u.getCareer() != null) return 0;
            u.setCareer(inv.getArgument(1));
            return 1;
        });
        when(users.fillPlanIfNull(any(), any(), any(), any())).thenAnswer(inv -> {
            var u = rows.get(inv.<UUID>getArgument(0));
            if (u == null || u.getPlan() != null || u.getCareer() != inv.getArgument(1)) return 0;
            u.setPlan(inv.getArgument(2));
            return 1;
        });
        when(users.markSgaSynced(any(), any())).thenAnswer(inv -> {
            var u = rows.get(inv.<UUID>getArgument(0));
            if (u == null) return 0;
            u.setSgaSyncedAt(inv.getArgument(1));
            return 1;
        });
        when(careers.findById(anyString())).thenAnswer(inv -> Optional.ofNullable(careerTable.get(inv.<String>getArgument(0))));
        when(plans.findByCareer_Id("S")).thenReturn(sPlans);
        when(plans.findByCareer_Id("I")).thenReturn(List.of());

        Executor sameThread = Runnable::run;
        service = new AcademicProfileSyncService(itba, users, careers, plans,
            mock(PlatformTransactionManager.class), sameThread, true, "itba.edu.ar");
    }

    @Test
    void fillsAllEmptyFields() {
        itba.stubStudent(EMAIL, new StudentProjection(61234, "S", "Informática", "S10-Rev23"));

        assertThat(service.syncNow(user.getId())).isEqualTo(AcademicProfileSyncService.Outcome.UPDATED);
        assertThat(user.getFileNumber()).isEqualTo(61234);
        assertThat(user.getCareer()).isSameAs(careerS);
        assertThat(user.getPlan()).isEqualTo("S10-Rev23");
    }

    @Test
    void neverOverwritesExistingValues() {
        user.setFileNumber(50000);
        user.setCareer(careerI);
        user.setPlan("I22");
        itba.stubStudent(EMAIL, new StudentProjection(61234, "S", "Informática", "S10-Rev23"));

        assertThat(service.syncNow(user.getId())).isEqualTo(AcademicProfileSyncService.Outcome.UNCHANGED);
        assertThat(user.getFileNumber()).isEqualTo(50000);
        assertThat(user.getCareer()).isSameAs(careerI);
        assertThat(user.getPlan()).isEqualTo("I22");
        verifyNoWrites();
    }

    @Test
    void planIsNotTakenFromAnotherCareer() {
        // Staff set career I; SGA says S. File number fills, plan stays empty.
        user.setCareer(careerI);
        itba.stubStudent(EMAIL, new StudentProjection(61234, "S", "Informática", "S10-Rev23"));

        service.syncNow(user.getId());
        assertThat(user.getCareer()).isSameAs(careerI);
        assertThat(user.getPlan()).isNull();
        assertThat(user.getFileNumber()).isEqualTo(61234);
    }

    @Test
    void planNameIsMatchedIgnoringPunctuation() {
        itba.stubStudent(EMAIL, new StudentProjection(null, "S", "Informática", "S10 A - Rev.18"));
        service.syncNow(user.getId());
        assertThat(user.getPlan()).isEqualTo("S10 A - Rev18");
    }

    @Test
    void unknownCareerCodeAndPlanAreSkipped() {
        itba.stubStudent(EMAIL, new StudentProjection(null, "ZZ", "?", "Z1"));
        assertThat(service.syncNow(user.getId())).isEqualTo(AcademicProfileSyncService.Outcome.UNCHANGED);
        assertThat(user.getCareer()).isNull();
        assertThat(user.getPlan()).isNull();

        itba.stubStudent(EMAIL, new StudentProjection(null, "S", "Informática", "S99-Unknown"));
        service.syncNow(user.getId());
        assertThat(user.getCareer()).isSameAs(careerS);
        assertThat(user.getPlan()).isNull();
    }

    @Test
    void fileNumberHeldByAnotherUserIsSkipped() {
        var other = new User(UUID.randomUUID(), "other@itba.edu.ar", "Other");
        when(users.findByFileNumber(61234)).thenReturn(Optional.of(other));
        itba.stubStudent(EMAIL, new StudentProjection(61234, "S", "Informática", null));

        service.syncNow(user.getId());
        assertThat(user.getFileNumber()).isNull();
        assertThat(user.getCareer()).isSameAs(careerS);
    }

    @Test
    void notInSgaLeavesProfileAlone() {
        assertThat(service.syncNow(user.getId())).isEqualTo(AcademicProfileSyncService.Outcome.NOT_IN_SGA);
        verifyNoWrites();
    }

    @Test
    void valuesWrittenConcurrentlyAreNotOverwritten() {
        // The row is read with empty columns, but a PATCH / staff edit commits
        // career and file number before the conditional UPDATEs run.
        var snapshot = new User(user.getId(), EMAIL, "Student");
        when(users.findById(user.getId())).thenReturn(Optional.of(snapshot));
        user.setFileNumber(50000);
        user.setCareer(careerI);
        itba.stubStudent(EMAIL, new StudentProjection(61234, "S", "Informática", "S10-Rev23"));

        assertThat(service.syncNow(user.getId())).isEqualTo(AcademicProfileSyncService.Outcome.UNCHANGED);
        assertThat(user.getFileNumber()).isEqualTo(50000);
        assertThat(user.getCareer()).isSameAs(careerI);
        assertThat(user.getPlan()).isNull();
        verify(users, never()).fillPlanIfNull(any(), any(), any(), any());
        verify(users, never()).save(any());
    }

    private void verifyNoWrites() {
        verify(users, never()).save(any());
        verify(users, never()).fillFileNumberIfNull(any(), any(), any());
        verify(users, never()).fillCareerIfNull(any(), any(), any());
        verify(users, never()).fillPlanIfNull(any(), any(), any(), any());
    }

    @Test
    void nonInstitutionalEmailIsNotLookedUp() {
        var outsider = new User(UUID.randomUUID(), "reviewer@gmail.com", "Reviewer");
        rows.put(outsider.getId(), outsider);
        itba.failStudentLookups(true); // would throw if called
        assertThat(service.syncNow(outsider.getId())).isEqualTo(AcademicProfileSyncService.Outcome.SKIPPED);
        assertThat(service.shouldSyncOnLogin(outsider)).isFalse();
    }

    @Test
    void explicitSyncPropagatesGatewayFailure() {
        itba.failStudentLookups(true);
        assertThatThrownBy(() -> service.syncNow(user.getId())).isInstanceOf(ExternalApiException.class);
    }

    @Test
    void backgroundSyncFillsAndSwallowsFailures() {
        itba.stubStudent(EMAIL, new StudentProjection(61234, "S", "Informática", "S10-Rev23"));
        service.syncInBackground(user);
        assertThat(user.getPlan()).isEqualTo("S10-Rev23");

        var fresh = new User(UUID.randomUUID(), EMAIL, "Again");
        rows.put(fresh.getId(), fresh);
        itba.failStudentLookups(true);
        assertThatCode(() -> service.syncInBackground(fresh)).doesNotThrowAnyException();
        assertThat(fresh.getCareer()).isNull();
        // A gateway failure is not an answer: the next login retries.
        assertThat(fresh.getSgaSyncedAt()).isNull();
        assertThat(service.shouldSyncOnLogin(fresh)).isTrue();
    }

    @Test
    void userUnknownToSgaIsNotLookedUpOnEveryLogin() {
        assertThat(service.shouldSyncOnLogin(user)).isTrue();
        service.syncInBackground(user);
        assertThat(user.getSgaSyncedAt()).isNotNull();
        assertThat(service.shouldSyncOnLogin(user)).isFalse();

        // The explicit endpoint still asks SGA.
        itba.stubStudent(EMAIL, new StudentProjection(61234, "S", "Informática", "S10-Rev23"));
        assertThat(service.syncNow(user.getId())).isEqualTo(AcademicProfileSyncService.Outcome.UPDATED);
        assertThat(user.getFileNumber()).isEqualTo(61234);
    }

    @Test
    void fieldsClearedByTheUserAreNotRefilledOnLogin() {
        itba.stubStudent(EMAIL, new StudentProjection(61234, "S", "Informática", "S10-Rev23"));
        service.syncInBackground(user);
        assertThat(user.getPlan()).isEqualTo("S10-Rev23");

        user.setPlan(null); // PATCH /v1/me/profile {"plan": ""}
        service.syncInBackground(user);
        assertThat(user.getPlan()).isNull();
        verify(users, times(1)).fillPlanIfNull(any(), any(), any(), any());
    }

    @Test
    void backgroundSyncSkipsCompleteProfilesAndRejectedTasks() {
        user.setFileNumber(1);
        user.setCareer(careerS);
        user.setPlan("S10-Rev23");
        assertThat(service.shouldSyncOnLogin(user)).isFalse();

        Executor rejecting = r -> { throw new RejectedExecutionException("full"); };
        var saturated = new AcademicProfileSyncService(itba, users, mock(CareerRepository.class),
            mock(PlanRepository.class), mock(PlatformTransactionManager.class), rejecting, true, "itba.edu.ar");
        var fresh = new User(UUID.randomUUID(), EMAIL, "Fresh");
        assertThatCode(() -> saturated.syncInBackground(fresh)).doesNotThrowAnyException();
    }

    @Test
    void disabledSyncNeverRunsOnLogin() {
        var disabled = new AcademicProfileSyncService(itba, users, mock(CareerRepository.class),
            mock(PlanRepository.class), mock(PlatformTransactionManager.class), Runnable::run, false, "itba.edu.ar");
        assertThat(disabled.shouldSyncOnLogin(user)).isFalse();
    }

    @Test
    void disabledSyncNeverCallsSgaOnExplicitRequest() {
        var disabled = new AcademicProfileSyncService(itba, users, mock(CareerRepository.class),
            mock(PlanRepository.class), mock(PlatformTransactionManager.class), Runnable::run, false, "itba.edu.ar");
        itba.stubStudent(EMAIL, new StudentProjection(61234, "S", "Informática", "S10-Rev23"));
        itba.failStudentLookups(true); // would throw if called

        assertThat(disabled.syncNow(user.getId())).isEqualTo(AcademicProfileSyncService.Outcome.SKIPPED);
        assertThat(user.getFileNumber()).isNull();
        verifyNoWrites();
    }
}
