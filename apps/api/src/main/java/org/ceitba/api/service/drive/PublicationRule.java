package org.ceitba.api.service.drive;

import org.ceitba.api.domain.drive.DriveFileKind;
import org.ceitba.api.domain.drive.DrivePublication;
import org.ceitba.api.domain.drive.DriveStaffDecision;

// Whether readers see a file (docs/DRIVE-SYNC.md, "Publish rule"). Pure, so
// it is recomputed from scratch after every sync, PATCH, source moderation
// and report:
//
//   folder                                     -> PRIVATE (never listed)
//   gone from Drive                            -> REMOVED
//   staff removed it                           -> REMOVED_BY_STAFF
//   no effective subject, or hidden            -> PRIVATE
//   source BLOCKED / REVOKED / DISCONNECTED    -> PRIVATE
//   staff published it                         -> PUBLISHED (sticky; reports ignored)
//   source not approved yet (PENDING_REVIEW)   -> NEEDS_REVIEW (held)
//   owned by someone else than the student     -> NEEDS_REVIEW
//   otherwise                                  -> PUBLISHED, or HIDDEN_REPORTED
//                                                 with >= 3 reports
public final class PublicationRule {

    public static final int REPORT_THRESHOLD = 3;

    private PublicationRule() {}

    public record Input(
        DriveFileKind kind,
        boolean removedFromDrive,
        DriveStaffDecision staffDecision,
        boolean hasEffectiveSubject,
        boolean effectivelyHidden,
        boolean sourceLive,
        boolean sourceApproved,
        boolean ownedBySharer,
        int reportCount
    ) {}

    public static DrivePublication decide(Input in) {
        if (in.kind() == DriveFileKind.FOLDER) return DrivePublication.PRIVATE;
        if (in.removedFromDrive()) return DrivePublication.REMOVED;
        if (in.staffDecision() == DriveStaffDecision.REMOVE) return DrivePublication.REMOVED_BY_STAFF;
        if (!in.hasEffectiveSubject() || in.effectivelyHidden()) return DrivePublication.PRIVATE;
        if (!in.sourceLive()) return DrivePublication.PRIVATE;
        if (in.staffDecision() == DriveStaffDecision.PUBLISH) return DrivePublication.PUBLISHED;
        if (!in.sourceApproved() || !in.ownedBySharer()) return DrivePublication.NEEDS_REVIEW;
        return in.reportCount() >= REPORT_THRESHOLD ? DrivePublication.HIDDEN_REPORTED : DrivePublication.PUBLISHED;
    }
}
