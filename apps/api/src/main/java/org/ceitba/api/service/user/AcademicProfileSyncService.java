package org.ceitba.api.service.user;

import jakarta.annotation.PreDestroy;
import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.domain.Career;
import org.ceitba.api.domain.Plan;
import org.ceitba.api.domain.User;
import org.ceitba.api.external.itba.ItbaApiClient;
import org.ceitba.api.external.itba.StudentProjection;
import org.ceitba.api.repository.CareerRepository;
import org.ceitba.api.repository.PlanRepository;
import org.ceitba.api.repository.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.Executor;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

// Prefills a user's academic data (file number, career, plan) from the ITBA
// SGA through ItbaApiClient: people-by-email gives the DNI, student-by-DNI
// gives legajo, careerCode and the active plan.
//
// Rules:
//   * Only fills columns that are still NULL. Values set by staff
//     (/v1/users/create) or by the user (PATCH /v1/me/profile) always win.
//   * careerCode maps to careers.id; an unknown code leaves the career empty.
//   * The plan is set only when the user's career is the SGA career and the
//     SGA plan name resolves to one of that career's plan ids (exactly, or
//     ignoring case, spaces and punctuation, e.g. "S10 A - Rev.18" ->
//     "S10 A - Rev18"), so the profile never holds a plan outside the catalogue.
//   * A file number already taken by another user is skipped.
//   * The DNI is never stored or logged; it stays inside ItbaApiClient.
//   * Every lookup SGA answers (found or not) stamps user.sga_synced_at; the
//     login hook only runs while that is NULL, so an unresolvable user is not
//     looked up on every login and a field the user cleared is not refilled.
//     Gateway failures leave it NULL, so the next login retries.
//
// Two entry points: syncNow (POST /v1/me/profile/sync-from-sga, errors
// propagate as ExternalApiException -> 502) and syncInBackground (login hook,
// fire-and-forget on a small bounded executor; failures are logged, never
// surface to the login).
@Service
public class AcademicProfileSyncService {

    private static final Logger log = LoggerFactory.getLogger(AcademicProfileSyncService.class);

    public enum Outcome { UPDATED, UNCHANGED, NOT_IN_SGA, SKIPPED }

    private final ItbaApiClient itba;
    private final UserRepository users;
    private final CareerRepository careers;
    private final PlanRepository plans;
    private final TransactionTemplate tx;
    private final Executor executor;
    private final boolean enabled;
    private final String emailDomain;

    @Autowired
    public AcademicProfileSyncService(ItbaApiClient itba,
                                      UserRepository users,
                                      CareerRepository careers,
                                      PlanRepository plans,
                                      PlatformTransactionManager txManager,
                                      @Value("${itba.profile-sync.enabled:true}") boolean enabled,
                                      @Value("${itba.profile-sync.email-domain:itba.edu.ar}") String emailDomain) {
        this(itba, users, careers, plans, txManager, newBoundedExecutor(), enabled, emailDomain);
    }

    // Tests pass a same-thread executor.
    AcademicProfileSyncService(ItbaApiClient itba,
                               UserRepository users,
                               CareerRepository careers,
                               PlanRepository plans,
                               PlatformTransactionManager txManager,
                               Executor executor,
                               boolean enabled,
                               String emailDomain) {
        this.itba = itba;
        this.users = users;
        this.careers = careers;
        this.plans = plans;
        this.tx = new TransactionTemplate(txManager);
        this.executor = executor;
        this.enabled = enabled;
        this.emailDomain = emailDomain.toLowerCase(Locale.ROOT);
    }

    // Small private pool (deliberately not a Spring Executor bean, which would
    // replace Boot's applicationTaskExecutor). When saturated the task is
    // dropped: the prefill is best-effort and must never pile up behind a slow
    // ITBA gateway.
    private static ThreadPoolExecutor newBoundedExecutor() {
        var counter = new AtomicInteger();
        return new ThreadPoolExecutor(2, 2, 60, TimeUnit.SECONDS, new ArrayBlockingQueue<>(200),
            r -> {
                var t = new Thread(r, "sga-sync-" + counter.incrementAndGet());
                t.setDaemon(true);
                return t;
            },
            (r, pool) -> log.warn("SGA profile sync queue full; task dropped"));
    }

    @PreDestroy
    void shutdown() {
        if (executor instanceof ExecutorService es) es.shutdownNow();
    }

    // True when the login hook should bother calling SGA for this user: only
    // until SGA has answered once (the explicit endpoint ignores this).
    public boolean shouldSyncOnLogin(User user) {
        return enabled
            && user.getSgaSyncedAt() == null
            && isInstitutional(user.getEmail())
            && (user.getFileNumber() == null || user.getCareer() == null || user.getPlan() == null);
    }

    // Login hook: never throws, never blocks on SGA.
    public void syncInBackground(User user) {
        if (!shouldSyncOnLogin(user)) return;
        UUID userId = user.getId();
        String email = user.getEmail();
        try {
            executor.execute(() -> {
                try {
                    var outcome = sync(userId, email);
                    log.debug("SGA profile sync for user {}: {}", userId, outcome);
                } catch (Exception e) {
                    log.warn("SGA profile sync failed for user {}: {}", userId, e.getMessage());
                }
            });
        } catch (Exception rejected) {
            log.warn("SGA profile sync not scheduled for user {}: {}", userId, rejected.getMessage());
        }
    }

    // Explicit, synchronous sync. ExternalApiException propagates. With
    // itba.profile-sync.enabled=false SGA is never called (SKIPPED).
    public Outcome syncNow(UUID userId) {
        var email = users.findById(userId)
            .map(User::getEmail)
            .orElseThrow(() -> new ResourceNotFoundException("User", userId.toString()));
        if (!enabled || !isInstitutional(email)) return Outcome.SKIPPED;
        return sync(userId, email);
    }

    Outcome sync(UUID userId, String email) {
        // The SGA calls happen outside any DB transaction.
        Optional<StudentProjection> student = itba.findStudentByEmail(email);
        return tx.execute(status -> {
            var outcome = student.map(s -> apply(userId, s)).orElse(Outcome.NOT_IN_SGA);
            users.markSgaSynced(userId, OffsetDateTime.now());
            return outcome;
        });
    }

    // Reads the current row to decide what to fill, then writes each column
    // with a conditional UPDATE (see UserRepository.fill*IfNull) rather than
    // saving the whole entity: a PATCH /v1/me/profile or staff edit committed
    // meanwhile is never overwritten, and "only fill NULL columns" also holds
    // at the database level.
    private Outcome apply(UUID userId, StudentProjection s) {
        var user = users.findById(userId).orElse(null);
        if (user == null) return Outcome.SKIPPED; // deleted meanwhile
        var now = OffsetDateTime.now();
        boolean changed = false;

        if (user.getFileNumber() == null && s.fileNumber() != null) {
            var holder = users.findByFileNumber(s.fileNumber());
            if (holder.isEmpty()) {
                changed |= users.fillFileNumberIfNull(userId, s.fileNumber(), now) > 0;
            } else if (!holder.get().getId().equals(userId)) {
                log.warn("SGA file number for user {} already belongs to user {}; not copied",
                    userId, holder.get().getId());
            }
        }

        Career career = user.getCareer();
        if (career == null && s.careerCode() != null) {
            var sgaCareer = careers.findById(s.careerCode());
            if (sgaCareer.isPresent() && users.fillCareerIfNull(userId, sgaCareer.get(), now) > 0) {
                career = sgaCareer.get();
                changed = true;
            }
        }

        if (user.getPlan() == null && s.planName() != null && career != null
                && career.getId().equals(s.careerCode())) {
            var planId = resolvePlan(career.getId(), s.planName());
            if (planId.isPresent()) {
                changed |= users.fillPlanIfNull(userId, career, planId.get(), now) > 0;
            }
        }

        return changed ? Outcome.UPDATED : Outcome.UNCHANGED;
    }

    private Optional<String> resolvePlan(String careerId, String sgaPlanName) {
        List<Plan> candidates = plans.findByCareer_Id(careerId);
        for (var p : candidates) {
            if (p.getId().equals(sgaPlanName)) return Optional.of(p.getId());
        }
        String key = planKey(sgaPlanName);
        var loose = candidates.stream().filter(p -> planKey(p.getId()).equals(key)).toList();
        return loose.size() == 1 ? Optional.of(loose.get(0).getId()) : Optional.empty();
    }

    static String planKey(String s) {
        return s.toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}\\p{N}]", "");
    }

    private boolean isInstitutional(String email) {
        return email != null && email.toLowerCase(Locale.ROOT).endsWith("@" + emailDomain);
    }
}
