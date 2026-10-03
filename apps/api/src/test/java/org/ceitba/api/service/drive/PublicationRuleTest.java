package org.ceitba.api.service.drive;

import org.ceitba.api.domain.drive.DriveFileKind;
import org.ceitba.api.domain.drive.DrivePublication;
import org.ceitba.api.domain.drive.DriveStaffDecision;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class PublicationRuleTest {

    // A file that is published under the plain rule.
    static PublicationRule.Input base() {
        return new PublicationRule.Input(DriveFileKind.PDF, false, null, true, false, true, true, true, 0);
    }

    static DrivePublication decide(PublicationRule.Input in) {
        return PublicationRule.decide(in);
    }

    static PublicationRule.Input with(PublicationRule.Input b, String field, Object v) {
        return new PublicationRule.Input(
            field.equals("kind") ? (DriveFileKind) v : b.kind(),
            field.equals("removed") ? (Boolean) v : b.removedFromDrive(),
            field.equals("decision") ? (DriveStaffDecision) v : b.staffDecision(),
            field.equals("subject") ? (Boolean) v : b.hasEffectiveSubject(),
            field.equals("hidden") ? (Boolean) v : b.effectivelyHidden(),
            field.equals("live") ? (Boolean) v : b.sourceLive(),
            field.equals("approved") ? (Boolean) v : b.sourceApproved(),
            field.equals("owned") ? (Boolean) v : b.ownedBySharer(),
            field.equals("reports") ? (Integer) v : b.reportCount());
    }

    @Test
    void ownFileWithSubjectInApprovedSourceIsPublished() {
        assertThat(decide(base())).isEqualTo(DrivePublication.PUBLISHED);
    }

    @Test
    void foldersAreNeverPublished() {
        assertThat(decide(with(base(), "kind", DriveFileKind.FOLDER))).isEqualTo(DrivePublication.PRIVATE);
    }

    @Test
    void privateWithoutSubjectOrWhenHiddenOrSourceDown() {
        assertThat(decide(with(base(), "subject", false))).isEqualTo(DrivePublication.PRIVATE);
        assertThat(decide(with(base(), "hidden", true))).isEqualTo(DrivePublication.PRIVATE);
        assertThat(decide(with(base(), "live", false))).isEqualTo(DrivePublication.PRIVATE);
    }

    @Test
    void needsReviewWhenOwnedByOthersOrSourcePending() {
        assertThat(decide(with(base(), "owned", false))).isEqualTo(DrivePublication.NEEDS_REVIEW);
        assertThat(decide(with(base(), "approved", false))).isEqualTo(DrivePublication.NEEDS_REVIEW);
    }

    @Test
    void reportsHidePublishedFilesAtThree() {
        assertThat(decide(with(base(), "reports", 2))).isEqualTo(DrivePublication.PUBLISHED);
        assertThat(decide(with(base(), "reports", 3))).isEqualTo(DrivePublication.HIDDEN_REPORTED);
        // Reports do not move a file that is not published anyway.
        assertThat(decide(with(with(base(), "owned", false), "reports", 5))).isEqualTo(DrivePublication.NEEDS_REVIEW);
    }

    @Test
    void staffDecisionsStick() {
        var published = with(base(), "decision", DriveStaffDecision.PUBLISH);
        assertThat(decide(with(published, "owned", false))).isEqualTo(DrivePublication.PUBLISHED);
        assertThat(decide(with(published, "approved", false))).isEqualTo(DrivePublication.PUBLISHED);
        assertThat(decide(with(published, "reports", 9))).isEqualTo(DrivePublication.PUBLISHED);
        // ...but never past the student's own choices or a dead source.
        assertThat(decide(with(published, "hidden", true))).isEqualTo(DrivePublication.PRIVATE);
        assertThat(decide(with(published, "live", false))).isEqualTo(DrivePublication.PRIVATE);

        var removed = with(base(), "decision", DriveStaffDecision.REMOVE);
        assertThat(decide(removed)).isEqualTo(DrivePublication.REMOVED_BY_STAFF);
        assertThat(decide(with(removed, "subject", false))).isEqualTo(DrivePublication.REMOVED_BY_STAFF);
    }

    @Test
    void goneFromDriveWins() {
        assertThat(decide(with(with(base(), "decision", DriveStaffDecision.PUBLISH), "removed", true)))
            .isEqualTo(DrivePublication.REMOVED);
    }
}
