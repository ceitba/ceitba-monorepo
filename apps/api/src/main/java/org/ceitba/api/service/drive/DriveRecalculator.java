package org.ceitba.api.service.drive;

import org.ceitba.api.domain.PlanSubject;
import org.ceitba.api.domain.Subject;
import org.ceitba.api.config.ClockConfig;
import org.ceitba.api.domain.drive.DriveAcademicYearSource;
import org.ceitba.api.domain.drive.DriveFile;
import org.ceitba.api.domain.drive.DrivePublication;
import org.ceitba.api.domain.drive.DriveSource;
import org.ceitba.api.repository.PlanSubjectRepository;
import org.ceitba.api.repository.SubjectRepository;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.service.kb.KbModerationService;
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
//   academic_year(_source) see academicYear()
//   publication           PublicationRule (published_at set on each move into PUBLISHED)
// Run after every walk, PATCH, source approve/block, staff decision, report
// and POST .../recompute-suggestions, so a plan change shows on the next one.
// A file that was PUBLISHED and no longer is (or now counts for another
// subject) takes down the wiki pages citing it (KbModerationService), so
// pages never keep quoting a file that stopped being public.
@Component
public class DriveRecalculator {

    private final SubjectRepository subjects;
    private final PlanSubjectRepository planSubjects;
    private final UserRepository users;
    private final KbModerationService kb;
    private final Clock clock;

    public DriveRecalculator(SubjectRepository subjects, PlanSubjectRepository planSubjects, UserRepository users,
                             KbModerationService kb, Clock clock) {
        this.subjects = subjects;
        this.planSubjects = planSubjects;
        this.users = users;
        this.kb = kb;
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
        int currentYear = now.atZoneSameInstant(ClockConfig.ZONE).getYear();
        Map<String, DriveFile> byDriveId = new HashMap<>();
        for (var f : files) byDriveId.put(f.getDriveId(), f);

        // Top-down, so each item sees its folders' suggestions.
        var ordered = new ArrayList<>(files);
        ordered.sort(Comparator.comparingInt(f -> depth(f, byDriveId)));
        Map<String, String> suggestionBelow = new HashMap<>();   // driveId -> suggestion it passes down
        var takenDown = new ArrayList<UUID>();

        for (var f : ordered) {
            boolean wasPublished = f.getPublication() == DrivePublication.PUBLISHED;
            String publishedSubject = f.getEffectiveSubjectId();
            String effective = null;
            boolean hidden = false;
            var seen = new HashSet<String>();
            for (var cur = f; cur != null && seen.add(cur.getDriveId());
                 cur = cur.getParentDriveId() == null ? null : byDriveId.get(cur.getParentDriveId())) {
                if (effective == null && cur.getSubjectId() != null) effective = cur.getSubjectId();
                if (cur.isHidden()) hidden = true;
            }
            f.setEffectiveSubjectId(effective);
            academicYear(f, byDriveId, currentYear);

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
            if (wasPublished && f.getId() != null
                && (publication != DrivePublication.PUBLISHED || !Objects.equals(publishedSubject, effective))) {
                takenDown.add(f.getId());
            }
        }
        if (!takenDown.isEmpty()) kb.hidePagesCiting(takenDown);
    }

    // USER (own) > INHERITED (an ancestor's USER) > NAME (own name, else the
    // nearest folder name with a year) > DRIVE (min(created, modified) in ART).
    static void academicYear(DriveFile f, Map<String, DriveFile> byDriveId, int currentYear) {
        if (f.getAcademicYearUser() != null) {
            f.setAcademicYear(f.getAcademicYearUser(), DriveAcademicYearSource.USER);
            return;
        }
        var seen = new HashSet<String>();
        seen.add(f.getDriveId());
        for (var p = parent(f, byDriveId); p != null && seen.add(p.getDriveId()); p = parent(p, byDriveId)) {
            if (p.getAcademicYearUser() != null) {
                f.setAcademicYear(p.getAcademicYearUser(), DriveAcademicYearSource.INHERITED);
                return;
            }
        }
        seen.clear();
        for (var cur = f; cur != null && seen.add(cur.getDriveId()); cur = parent(cur, byDriveId)) {
            var y = AcademicYears.fromName(cur.getName(), currentYear);
            if (y.isPresent()) {
                f.setAcademicYear(y.getAsInt(), DriveAcademicYearSource.NAME);
                return;
            }
        }
        OffsetDateTime first = f.getDriveCreatedAt();
        var modified = f.getDriveModifiedAt();
        if (first == null || (modified != null && modified.isBefore(first))) first = modified;
        f.setAcademicYear(first == null ? null : first.atZoneSameInstant(ClockConfig.ZONE).getYear(),
            DriveAcademicYearSource.DRIVE);
    }

    private static DriveFile parent(DriveFile f, Map<String, DriveFile> byDriveId) {
        return f.getParentDriveId() == null ? null : byDriveId.get(f.getParentDriveId());
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
