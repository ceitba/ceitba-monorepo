package org.ceitba.api.service.drive;

import org.ceitba.api.domain.drive.DriveFile;
import org.ceitba.api.repository.drive.DriveFileRepository;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

// Stored copies are keyed by content, not by row: drive/<driveId>/<fp>/...
// where <fp> hashes the content fingerprint. Rows of the same Drive item with
// the same fingerprint (another student's source, a row moved between
// sources) share them, so objects are deleted only when no other row still
// holds that (driveId, fingerprint). Call inside the transaction that drops
// the rows' content; delete the returned keys after commit.
@Component
public class DriveBlobs {

    private static final UUID NONE = new UUID(0, 0);

    private final DriveFileRepository files;

    public DriveBlobs(DriveFileRepository files) {
        this.files = files;
    }

    public record Ref(String driveId, String fingerprint, List<String> keys) {
        public static Ref of(DriveFile f) {
            return new Ref(f.getDriveId(), f.getContentFingerprint(), f.storageKeys());
        }
    }

    public static String prefix(String driveId, String fingerprint) {
        return "drive/" + driveId.replaceAll("[^A-Za-z0-9_-]", "_") + "/" + hash(fingerprint) + "/";
    }

    // Keys of `refs` that no row outside `excludedRowIds` still uses.
    public List<String> releasable(Collection<Ref> refs, Collection<UUID> excludedRowIds) {
        Set<UUID> excluded = new HashSet<>(excludedRowIds);
        if (excluded.isEmpty()) excluded.add(NONE);
        var out = new LinkedHashSet<String>();
        var checked = new HashSet<String>();
        for (var r : refs) {
            if (r.fingerprint() == null || r.keys().isEmpty()) continue;
            if (!checked.add(r.driveId() + "\n" + r.fingerprint())) {
                continue;
            }
            if (files.countOtherHolders(r.driveId(), r.fingerprint(), excluded) == 0) out.addAll(r.keys());
        }
        return new ArrayList<>(out);
    }

    static String hash(String fingerprint) {
        try {
            var d = MessageDigest.getInstance("SHA-256")
                .digest(String.valueOf(fingerprint).getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(d, 0, 8);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
