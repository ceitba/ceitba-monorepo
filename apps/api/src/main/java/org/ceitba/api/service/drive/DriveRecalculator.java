package org.ceitba.api.service.drive;

import org.ceitba.api.domain.PlanSubject;
import org.ceitba.api.domain.Subject;
import org.ceitba.api.domain.drive.DriveFile;
import org.ceitba.api.domain.drive.DrivePublication;
import org.ceitba.api.domain.drive.DriveSource;
import org.ceitba.api.repository.PlanSubjectRepository;
import org.ceitba.api.repository.SubjectRepository;
import org.ceitba.api.repository.UserRepository;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.stream.Collectors;

// Recomputes the derived columns of every file of a source, in memory (the
// caller's transaction flushes them):
//   effective_subject_id  own subject, else the nearest ancestor's
//   suggested_subject_id  SubjectMatcher on the name (the source owner's plan
//                         first), only without an effective subject, and
//                         only where it differs from the suggestion the item
//                         inherits from its folders (a matched folder covers
//                         its unmatched children)
//   publication           PublicationRule (published_at set on each move into PUBLISHED)
// Run after every walk, PATCH, source approve/block, staff decision, report
// and POST .../recompute-suggestions, so a plan change shows on the next one.
@Component
public class DriveRecalculator {

    private final SubjectRepository subjects;
    private final PlanSubjectRepository planSubjects;
    private final UserRepository users;
    private final Clock clock;

    public DriveRecalculator(SubjectRepository subjects, PlanSubjectRepository planSubjects, UserRepository users,
                             Clock clock) {
        this.subjects = subjects;
        this.planSubjects = planSubjects;
        this.users = users;
        this.clock = clock;
    }

    // Subject ids of the user's plan in plan order (year, semester, id);
    // empty without a plan.
    public List<String> planSubjectIds(UUID userId) {
        var plan = users.findById(userId).map(u -> u.getPlan()).orElse(null);
        if (plan == null || plan.isBlank()) return List.of();
        return planSubjects.findByPlanId(plan).stream()
            .sorted(Comparator.comparingInt(PlanSubject::getYear).thenComparingInt(PlanSubject::getSemester)
                .thenComparing(PlanSubject::getSubjectId))
            .map(PlanSubject::getSubjectId)
            .toList();
    }

    public SubjectMatcher matcher(List<String> planSubjectIds) {
        return new SubjectMatcher(subjects.findAll().stream()
            .collect(Collectors.toMap(Subject::getId, Subject::getName, (a, b) -> a)), planSubjectIds);
    }

    public void recompute(DriveSource source, List<DriveFile> files) {
        recompute(source, files, matcher(planSubjectIds(source.getUserId())));
    }

    public void recompute(DriveSource source, List<DriveFile> files, SubjectMatcher matcher) {
        var now = OffsetDateTime.now(clock);
        Map<String, DriveFile> byDriveId = new HashMap<>();
        for (var f : files) byDriveId.put(f.getDriveId(), f);

        // Top-down, so each item sees its folders' suggestions.
        var ordered = new ArrayList<>(files);
        ordered.sort(Comparator.comparingInt(f -> depth(f, byDriveId)));
        Map<String, String> suggestionBelow = new HashMap<>();   // driveId -> suggestion it passes down

        for (var f : ordered) {
            String effective = null;
            boolean hidden = false;
            var seen = new HashSet<String>();
            for (var cur = f; cur != null && seen.add(cur.getDriveId());
                 cur = cur.getParentDriveId() == null ? null : byDriveId.get(cur.getParentDriveId())) {
                if (effective == null && cur.getSubjectId() != null) effective = cur.getSubjectId();
                if (cur.isHidden()) hidden = true;
            }
            f.setEffectiveSubjectId(effective);

            var inherited = f.getParentDriveId() == null ? null : suggestionBelow.get(f.getParentDriveId());
            String suggested = null;
            if (effective == null && !f.isRemovedFromDrive()) {
                var own = matcher.match(f.getName()).orElse(null);
                if (own != null && !Objects.equals(own, inherited)) suggested = own;
            }
            f.setSuggestedSubjectId(suggested);
            suggestionBelow.put(f.getDriveId(), effective != null ? null : (suggested != null ? suggested : inherited));

            var publication = PublicationRule.decide(new PublicationRule.Input(
                f.getKind(), f.isRemovedFromDrive(), f.getStaffDecision(), effective != null, hidden,
                source.isLive(), source.isApproved(), f.isOwnedBySharer(), f.getReportCount()));
            if (publication == DrivePublication.PUBLISHED && f.getPublication() != DrivePublication.PUBLISHED) {
                f.setPublishedAt(now);
            }
            f.setPublication(publication);
        }
    }

    // Depth of each item below the root (direct children: 0).
    static int depth(DriveFile f, Map<String, DriveFile> byDriveId) {
        int d = 0;
        var seen = new HashSet<String>();
        for (var cur = f; cur.getParentDriveId() != null && seen.add(cur.getDriveId()); d++) {
            cur = byDriveId.get(cur.getParentDriveId());
            if (cur == null) break;
        }
        return d;
    }
}
