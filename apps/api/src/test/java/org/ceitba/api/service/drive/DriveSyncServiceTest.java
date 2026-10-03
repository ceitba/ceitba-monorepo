package org.ceitba.api.service.drive;

import org.ceitba.api.external.drive.DriveClient;
import org.ceitba.api.external.drive.DriveItem;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class DriveSyncServiceTest {

    static final String PDF = "application/pdf";

    static DriveItem item(String id, String mime, String owner, String targetId) {
        return new DriveItem(id, id, mime, List.of(), List.of(owner), null, null, 1L, null, targetId, null, null);
    }

    @Test
    void shortcutIsFollowedOnlyToItemsTheStudentOwns() {
        var drive = mock(DriveClient.class);
        var sync = new DriveSyncService(drive, null, null, null, null);
        when(drive.getFile("own-file-0001")).thenReturn(item("own-file-0001", PDF, "Alumno@itba.edu.ar", null));
        when(drive.getFile("other-file-01")).thenReturn(item("other-file-01", PDF, "otro@itba.edu.ar", null));

        var own = item("sc-1", DriveItem.SHORTCUT_MIME, "alumno@itba.edu.ar", "own-file-0001");
        var other = item("sc-2", DriveItem.SHORTCUT_MIME, "alumno@itba.edu.ar", "other-file-01");

        assertThat(sync.resolveShortcut(own, "alumno@itba.edu.ar")).extracting(DriveItem::id).isEqualTo("own-file-0001");
        // Another student's file the bot can read: never pulled into this source.
        assertThat(sync.resolveShortcut(other, "alumno@itba.edu.ar")).isNull();
        // Unknown owner (account gone): nothing is followed.
        assertThat(sync.resolveShortcut(own, null)).isNull();
    }
}
