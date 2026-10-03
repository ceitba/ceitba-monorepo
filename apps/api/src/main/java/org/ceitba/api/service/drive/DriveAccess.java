package org.ceitba.api.service.drive;

import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.domain.drive.DriveFile;
import org.ceitba.api.domain.drive.DrivePublication;
import org.ceitba.api.domain.drive.DriveSource;
import org.ceitba.api.external.drive.DriveClient;
import org.ceitba.api.repository.CeitbaStaffRepository;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.UUID;

// Who may see what. Readers see PUBLISHED files only; STAFF can open any
// file, and the source's student can preview the files of their source that
// they own in Drive (ownedBySharer). A file someone else owns that sits in
// their folder is not theirs to read through the bot.
@Component
public class DriveAccess {

    private final CeitbaStaffRepository staff;
    private final DriveClient drive;
    private final Clock clock;

    public DriveAccess(CeitbaStaffRepository staff, DriveClient drive, Clock clock) {
        this.staff = staff;
        this.drive = drive;
        this.clock = clock;
    }

    public boolean isStaff(UUID userId) {
        return staff.isActiveStaff(userId, OffsetDateTime.now(clock));
    }

    public boolean canView(UUID userId, DriveFile file, DriveSource source) {
        if (file.isFolder()) return false;
        if (file.getPublication() == DrivePublication.PUBLISHED) return true;
        if (userId != null && userId.equals(source.getUserId()) && file.isOwnedBySharer()) return true;
        return isStaff(userId);
    }

    public void requireDriveAvailable() {
        if (!drive.available()) {
            throw new DriveException(DriveException.Reason.SYNC_UNCONFIGURED,
                "Drive sync is not configured on this server");
        }
    }

    public static ResourceNotFoundException fileNotFound(Object id) {
        return new ResourceNotFoundException("DriveFile", String.valueOf(id));
    }

    public static ResourceNotFoundException sourceNotFound(Object id) {
        return new ResourceNotFoundException("DriveSource", String.valueOf(id));
    }
}
