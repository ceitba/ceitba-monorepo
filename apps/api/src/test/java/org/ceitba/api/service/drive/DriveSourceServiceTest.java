package org.ceitba.api.service.drive;

import org.ceitba.api.domain.User;
import org.ceitba.api.domain.drive.DriveSourceStatus;
import org.ceitba.api.external.drive.DriveClient;
import org.ceitba.api.repository.CeitbaStaffRepository;
import org.ceitba.api.repository.drive.DriveSourceRepository;
import org.ceitba.api.web.drive.dto.RegisterSourceRequest;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class DriveSourceServiceTest {

    @Test
    void aFolderStaffBlockedCannotBeRegisteredAgain() {
        var sources = mock(DriveSourceRepository.class);
        var drive = mock(DriveClient.class);
        when(drive.available()).thenReturn(true);
        var clock = Clock.systemUTC();
        var access = new DriveAccess(mock(CeitbaStaffRepository.class), drive, clock);
        var service = new DriveSourceService(sources, null, null, null, drive, access, null, null, null, null,
            null, null, clock);
        var folderId = "1AbCdEfGhIjKlMnOp";
        when(sources.existsByRootFolderIdAndStatus(folderId, DriveSourceStatus.BLOCKED)).thenReturn(true);

        var user = new User(UUID.randomUUID(), "alumno@itba.edu.ar", "Alumno");
        var req = new RegisterSourceRequest("https://drive.google.com/drive/folders/" + folderId,
            DriveConsent.VERSION, false);

        assertThatThrownBy(() -> service.register(user, req))
            .isInstanceOfSatisfying(DriveException.class,
                e -> org.assertj.core.api.Assertions.assertThat(e.reason())
                    .isEqualTo(DriveException.Reason.SOURCE_BLOCKED));
        verify(drive, never()).getFile(anyString());
    }
}
