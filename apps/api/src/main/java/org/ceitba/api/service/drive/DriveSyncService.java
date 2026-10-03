package org.ceitba.api.service.drive;

import org.ceitba.api.config.DriveSyncProperties;
import org.ceitba.api.external.drive.DriveApiException;
import org.ceitba.api.external.drive.DriveClient;
import org.ceitba.api.external.drive.DriveItem;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

// Mirrors registered Drive folders (docs/DRIVE-SYNC.md). For each source:
//
//   1. files.get(root): 404/403 -> REVOKED (everything unpublished).
//   2. BFS walk ("'<id>' in parents and trashed=false"). Shortcuts resolve to
//      their target only when the bot can read it AND the source's student
//      owns it (Drive `owners`); anything else is skipped, so a shortcut
//      cannot pull another student's file through the bot's access. A
//      folder seen twice (shortcut cycles) is walked once. Forms/sites/...
//      are skipped.
//   3. DriveSyncStore.applyWalk: upsert metadata, mark missing items REMOVED
//      only when the walk was COMPLETE, recompute subjects/publication.
//   4. Check new/changed content (DriveContentProcessor; see DriveSyncStore
//      for the triggers): store it, keep the current copy when the content
//      hash did not change, or share another row's copy; a per-file error
//      sets drive_file.sync_error and the source carries on.
//
// No transaction is held across Drive or storage I/O. A source is synced by
// one thread at a time (job and manual/async triggers share `inProgress`).
// A source-level failure counts towards ERROR (5 in a row). Rate limits stop
// the whole run (the client already backed off); the budget deadline stops
// it too, leaving the rest for the next run. Any other exception fails
// only its source; the 30-day purge always runs.
@Service
public class DriveSyncService {

    private static final Logger log = LoggerFactory.getLogger(DriveSyncService.class);

    public enum Outcome { SYNCED, PARTIAL, REVOKED, FAILED, RATE_LIMITED, SKIPPED }

    private final DriveClient drive;
    private final DriveSyncStore store;
    private final DriveContentProcessor processor;
    private final DriveSyncProperties props;
    private final Clock clock;
    private final Set<UUID> inProgress = ConcurrentHashMap.newKeySet();

    public DriveSyncService(DriveClient drive, DriveSyncStore store, DriveContentProcessor processor,
                            DriveSyncProperties props, Clock clock) {
        this.drive = drive;
        this.store = store;
        this.processor = processor;
        this.props = props;
        this.clock = clock;
    }

    // One scheduled run: unclaimed shares, every syncable source (oldest
    // sync first) until the budget runs out, then the 30-day purge.
    public void runAll() {
        if (!drive.available()) return;
        var deadline = clock.instant().plus(props.runBudget());
        int synced = 0;
        try {
            try {
                store.recordUnclaimed(drive.listSharedFolders());
            } catch (DriveApiException e) {
                log.warn("Drive sync: listing shared folders failed: {} {}", e.status(), e.getMessage());
                if (e.isRateLimited()) return;
            } catch (RuntimeException e) {
                log.warn("Drive sync: recording unclaimed shares failed", e);
            }
            for (var id : store.idsToSync()) {
                if (clock.instant().isAfter(deadline)) {
                    log.info("Drive sync: run budget exhausted after {} sources", synced);
                    break;
                }
                Outcome outcome;
                try {
                    outcome = syncSource(id, deadline, false);
                } catch (RuntimeException e) {
                    log.error("Drive sync: source {} failed unexpectedly", id, e);
                    recordFailureQuietly(id, "Unexpected error: " + e.getClass().getSimpleName());
                    outcome = Outcome.FAILED;
                }
                if (outcome == Outcome.RATE_LIMITED) {
                    log.warn("Drive sync: rate limited, stopping this run after {} sources", synced);
                    break;
                }
                synced++;
            }
        } finally {
            store.purgeExpired();
        }
        log.info("Drive sync run done: {} sources", synced);
    }

    private void recordFailureQuietly(UUID sourceId, String error) {
        try {
            store.recordFailure(sourceId, error);
        } catch (RuntimeException e) {
            log.warn("Drive sync: could not record the failure of source {}: {}", sourceId, e.getMessage());
        }
    }

    public Outcome syncSource(UUID sourceId) {
        return syncSource(sourceId, clock.instant().plus(props.runBudget()), true);
    }

    Outcome syncSource(UUID sourceId, Instant deadline, boolean allowRevoked) {
        if (!drive.available()) return Outcome.SKIPPED;
        if (!inProgress.add(sourceId)) return Outcome.SKIPPED;
        try {
            var snapshot = store.snapshot(sourceId, allowRevoked).orElse(null);
            if (snapshot == null) return Outcome.SKIPPED;
            return doSync(snapshot, deadline);
        } finally {
            inProgress.remove(sourceId);
        }
    }

    private Outcome doSync(DriveSyncStore.Snapshot source, Instant deadline) {
        DriveItem root;
        try {
            root = drive.getFile(source.rootFolderId());
        } catch (DriveApiException e) {
            if (e.isNotFoundOrForbidden()) {
                log.info("Drive sync: source {} revoked ({} {})", source.id(), e.status(), e.reason());
                store.markRevoked(source.id(), "The bot can no longer access the shared folder");
                return Outcome.REVOKED;
            }
            return fail(source, e);
        }
        if (!root.isFolder()) {
            store.markRevoked(source.id(), "The shared item is no longer a folder");
            return Outcome.REVOKED;
        }

        List<DriveSyncStore.WalkedItem> walked = new ArrayList<>();
        boolean complete;
        try {
            complete = walk(root, walked, deadline, source.ownerEmail(), source.id());
        } catch (DriveApiException e) {
            return fail(source, e);
        }

        var tasks = store.applyWalk(source.id(), root.name(), walked, complete, source.ownerEmail());
        // Disconnected, blocked or deleted while we walked: nothing applied.
        if (tasks == null) return Outcome.SKIPPED;
        boolean allFetched = true;
        for (var task : tasks) {
            if (clock.instant().isAfter(deadline)) {
                allFetched = false;
                break;
            }
            try {
                var content = processor.process(new DriveContentProcessor.Request(task.fileId(),
                        task.driveId(), task.kind(), task.name(), task.mimeType(), task.version(),
                        task.knownFingerprint(), task.size()),
                    fp -> store.hasCopy(task.fileId(), task.driveId(), fp));
                if (!store.storeContent(source.id(), task.fileId(), task.driveId(), content, task.modifiedAt())) {
                    if (!store.isSyncable(source.id())) {
                        log.info("Drive sync: source {} is gone or no longer syncable, stopping", source.id());
                        return Outcome.SKIPPED;
                    }
                }
            } catch (DriveApiException e) {
                store.storeError(task.fileId(), "Drive " + e.status() + " " + e.reason() + ": " + e.getMessage());
                if (e.isRateLimited()) {
                    store.recordFailure(source.id(), "Rate limited by Google Drive");
                    return Outcome.RATE_LIMITED;
                }
            } catch (RuntimeException e) {
                log.warn("Drive sync: file {} of source {} failed: {}", task.driveId(), source.id(), e.toString());
                store.storeError(task.fileId(), e.getClass().getSimpleName() + ": " + e.getMessage());
            }
        }
        store.finishSync(source.id());
        log.info("Drive sync: source {} synced ({} items, {} fetched, complete={})",
            source.id(), walked.size(), tasks.size(), complete && allFetched);
        return complete && allFetched ? Outcome.SYNCED : Outcome.PARTIAL;
    }

    // BFS from the root. Returns false when the walk stopped early (budget
    // or a folder that vanished mid-walk): missing items must then not be
    // treated as removed.
    private boolean walk(DriveItem root, List<DriveSyncStore.WalkedItem> out, Instant deadline,
                         String ownerEmail, UUID sourceId) {
        var queue = new ArrayDeque<String>();
        var visitedFolders = new HashSet<String>();
        var seenItems = new HashSet<String>();
        queue.add(root.id());
        visitedFolders.add(root.id());
        seenItems.add(root.id());
        boolean complete = true;
        int skippedShortcuts = 0;
        while (!queue.isEmpty()) {
            if (clock.instant().isAfter(deadline)) return false;
            var folderId = queue.poll();
            List<DriveItem> children;
            try {
                children = drive.listChildren(folderId);
            } catch (DriveApiException e) {
                if (e.isNotFoundOrForbidden() && !folderId.equals(root.id())) {
                    complete = false;
                    continue;
                }
                throw e;
            }
            var parent = folderId.equals(root.id()) ? null : folderId;
            for (var child : children) {
                var item = child;
                if (child.isShortcut()) {
                    item = resolveShortcut(child, ownerEmail);
                    if (item == null) {
                        skippedShortcuts++;
                        continue;
                    }
                }
                if (!seenItems.add(item.id())) continue;
                var kind = DriveKinds.of(item.mimeType());
                if (kind.isEmpty()) continue;
                out.add(new DriveSyncStore.WalkedItem(item, parent, kind.get()));
                if (item.isFolder() && visitedFolders.add(item.id())) queue.add(item.id());
            }
        }
        if (skippedShortcuts > 0) {
            log.info("Drive sync: source {}: skipped {} shortcuts (unreadable or not owned by the student)",
                sourceId, skippedShortcuts);
        }
        return complete;
    }

    // The shortcut's target as if it sat where the shortcut is, or null
    // (skipped) when the bot cannot read it or the source's student does not
    // own it: the bot can read files other students shared with it, and a
    // shortcut must never republish those under this source.
    DriveItem resolveShortcut(DriveItem shortcut, String ownerEmail) {
        if (shortcut.shortcutTargetId() == null || ownerEmail == null) return null;
        try {
            var target = drive.getFile(shortcut.shortcutTargetId());
            return target.isShortcut() || !target.ownedBy(ownerEmail) ? null : target;
        } catch (DriveApiException e) {
            if (e.isNotFoundOrForbidden()) return null;
            throw e;
        }
    }

    private Outcome fail(DriveSyncStore.Snapshot source, DriveApiException e) {
        log.warn("Drive sync: source {} failed: {} {} {}", source.id(), e.status(), e.reason(), e.getMessage());
        store.recordFailure(source.id(), "Google Drive error " + e.status() + (e.reason() == null ? "" : " " + e.reason()));
        return e.isRateLimited() ? Outcome.RATE_LIMITED : Outcome.FAILED;
    }
}
