package org.ceitba.api.service.drive;

import org.ceitba.api.config.DriveSyncProperties;
import org.ceitba.api.external.drive.DriveApiException;
import org.ceitba.api.external.drive.DriveClient;
import org.ceitba.api.repository.SubjectRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Pattern;

// Community archives (docs/DRIVE-SYNC.md, "Community sources"): at the start
// of every sync run, each ACTIVE COMMUNITY_ROOT's top-level folders are listed
// and kept in sync as one COMMUNITY source per subject folder, so every walk
// stays small. A folder named "<code> - <name>" ("11.77 - Estadística
// Aplicada 1", "12.43 - 12.44 - Ciencia de Materiales") maps to the first of
// its leading codes that exists in public.subject (a source has one subject).
// Skipped (no source): names starting with "00." (organizational folders),
// names without a leading code, codes not in public.subject (picked up on a
// later run once the subject exists) and, when DRIVE_SYNC_COMMUNITY_ONLY_CODES
// is set (dev), codes not in it. Sources of folders that are no longer listed
// (or now skipped) are disconnected.
@Service
public class DriveCommunityService {

    private static final Logger log = LoggerFactory.getLogger(DriveCommunityService.class);

    // Leading "dd.dd" codes, separated by " - ", "-", "/", "," or spaces.
    private static final Pattern LEADING_CODES = Pattern.compile("^\\s*(\\d{2}\\.\\d{2}(?:\\s*[-/,]?\\s*\\d{2}\\.\\d{2})*)");
    private static final Pattern CODE = Pattern.compile("\\d{2}\\.\\d{2}");

    private final DriveClient drive;
    private final DriveSyncStore store;
    private final SubjectRepository subjects;
    private final DriveSyncProperties props;

    public DriveCommunityService(DriveClient drive, DriveSyncStore store, SubjectRepository subjects,
                                 DriveSyncProperties props) {
        this.drive = drive;
        this.store = store;
        this.subjects = subjects;
        this.props = props;
    }

    // The subject codes at the start of a top-level folder name, in order;
    // empty for "00.xx" folders and names without a leading code.
    static List<String> codes(String folderName) {
        if (folderName == null) return List.of();
        var m = LEADING_CODES.matcher(folderName);
        if (!m.find()) return List.of();
        var out = new ArrayList<String>();
        var c = CODE.matcher(m.group(1));
        while (c.find()) out.add(c.group());
        if (out.get(0).startsWith("00.")) return List.of();
        return out;
    }

    // The subject a folder maps to: its first code that is a known subject
    // (and allowed by onlyCodes when that is not empty).
    static Optional<String> subjectFor(String folderName, Set<String> knownSubjects, Set<String> onlyCodes) {
        return codes(folderName).stream()
            .filter(knownSubjects::contains)
            .filter(code -> onlyCodes.isEmpty() || onlyCodes.contains(code))
            .findFirst();
    }

    public void expandAll() {
        if (!props.communityEnabled() || !drive.available()) return;
        var roots = store.activeCommunityRoots();
        if (roots.isEmpty()) return;
        Set<String> known = new HashSet<>();
        subjects.findAll().forEach(s -> known.add(s.getId()));
        var onlyCodes = Set.copyOf(props.communityOnlyCodes());
        for (var root : roots) expand(root, known, onlyCodes);
    }

    private void expand(DriveSyncStore.CommunityRoot root, Set<String> known, Set<String> onlyCodes) {
        String ownerEmail;
        List<org.ceitba.api.external.drive.DriveItem> children;
        try {
            ownerEmail = drive.getFile(root.rootFolderId()).firstOwner();
            children = drive.listChildren(root.rootFolderId());
        } catch (DriveApiException e) {
            // A failed listing never disconnects anything.
            if (e.isRateLimited()) throw e;
            log.warn("Drive sync: community root {} not listable: {} {}", root.id(), e.status(), e.reason());
            return;
        }
        var folders = new ArrayList<DriveSyncStore.CommunityFolder>();
        for (var child : children) {
            if (!child.isFolder()) continue;
            subjectFor(child.name(), known, onlyCodes).ifPresent(subject ->
                folders.add(new DriveSyncStore.CommunityFolder(child.id(), child.name(), subject)));
        }
        var result = store.applyCommunityFolders(root.id(), ownerEmail, folders);
        log.info("Drive sync: community root {}: {} subject folders ({} new, {} disconnected)",
            root.id(), folders.size(), result[0], result[1]);
    }
}
