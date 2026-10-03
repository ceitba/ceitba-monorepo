package org.ceitba.api.service.drive;

import org.ceitba.api.domain.drive.DriveFileKind;
import org.ceitba.api.domain.drive.DriveStorageMode;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class DriveReferenceModeTest {

    static final long MB = 1024 * 1024;

    static DriveSyncStore.Candidate pdf(String fingerprint, boolean byReference) {
        return new DriveSyncStore.Candidate(UUID.randomUUID(), "d1", DriveFileKind.PDF, "a.pdf", "application/pdf", 3L,
            "abc", 5 * MB, null, fingerprint, 3L, null, false, byReference);
    }

    @Test
    void referenceModeAndSizeThresholdDecideStorageAndAModeChangeRefetches() {
        assertThat(DriveSyncStore.byReference(DriveStorageMode.REFERENCE, 1L, 20 * MB)).isTrue();
        assertThat(DriveSyncStore.byReference(DriveStorageMode.COPY, 25 * MB, 20 * MB)).isTrue();
        assertThat(DriveSyncStore.byReference(DriveStorageMode.COPY, 5 * MB, 20 * MB)).isFalse();
        assertThat(DriveSyncStore.byReference(DriveStorageMode.COPY, null, 20 * MB)).isFalse();

        // Up to date in its mode: nothing to do.
        assertThat(DriveSyncStore.needsFetch(pdf("md5:abc", false), false)).isFalse();
        assertThat(DriveSyncStore.needsFetch(pdf("ref:md5:abc", true), true)).isFalse();
        // Mode changed (stored copy -> reference, or back): fetched again.
        assertThat(DriveSyncStore.needsFetch(pdf("md5:abc", false), true)).isTrue();
        assertThat(DriveSyncStore.needsFetch(pdf("ref:md5:abc", true), false)).isTrue();
        // Videos, audio and archives are never rows at all; images only in student sources.
        assertThat(DriveKinds.of("video/mp4", "clase.mp4", true)).isEmpty();
        assertThat(DriveKinds.of("application/zip", "tp.zip", true)).isEmpty();
        assertThat(DriveKinds.of("text/x-python", "tp.py", true)).contains(DriveFileKind.OTHER);
        assertThat(DriveKinds.of("image/png", "pizarron.png", false)).isEmpty();
    }
}
