package org.ceitba.api.service.drive;

import org.ceitba.api.domain.Subject;
import org.ceitba.api.domain.drive.DriveFile;
import org.ceitba.api.domain.drive.DrivePublication;
import org.ceitba.api.domain.drive.DriveSource;
import org.ceitba.api.repository.SubjectRepository;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

// Recomputes the derived columns of every file of a source, in memory (the
// caller's transaction flushes them):
//   effective_subject_id  own subject, else the nearest ancestor's
//   suggested_subject_id  SubjectMatcher on the name, only without an effective subject
//   publication           PublicationRule (published_at set on each move into PUBLISHED)
// Run after every walk, PATCH, source approve/block, staff decision and report.
@Component
public class DriveRecalculator {

    private final SubjectRepository subjects;
    private final Clock clock;

    public DriveRecalculator(SubjectRepository subjects, Clock clock) {
        this.subjects = subjects;
        this.clock = clock;
    }

    public SubjectMatcher matcher() {
        return new SubjectMatcher(subjects.findAll().stream()
            .collect(Collectors.toMap(Subject::getId, Subject::getName, (a, b) -> a)));
    }

    public void recompute(DriveSource source, List<DriveFile> files) {
        recompute(source, files, matcher());
    }

    public void recompute(DriveSource source, List<DriveFile> files, SubjectMatcher matcher) {
        var now = OffsetDateTime.now(clock);
        Map<String, DriveFile> byDriveId = new HashMap<>();
        for (var f : files) byDriveId.put(f.getDriveId(), f);

        for (var f : files) {
            String effective = null;
            boolean hidden = false;
            var seen = new HashSet<String>();
            for (var cur = f; cur != null && seen.add(cur.getDriveId());
                 cur = cur.getParentDriveId() == null ? null : byDriveId.get(cur.getParentDriveId())) {
                if (effective == null && cur.getSubjectId() != null) effective = cur.getSubjectId();
                if (cur.isHidden()) hidden = true;
            }
            f.setEffectiveSubjectId(effective);
            f.setSuggestedSubjectId(effective == null && !f.isRemovedFromDrive()
                ? matcher.match(f.getName()).orElse(null) : null);

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
