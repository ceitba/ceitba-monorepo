package org.ceitba.api.service.drive;

import org.ceitba.api.config.DriveSyncProperties;
import org.ceitba.api.external.drive.DriveApiException;
import org.ceitba.api.external.drive.DriveClient;
import org.ceitba.api.external.drive.DriveItem;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

// Mirrors registered Drive folders (docs/DRIVE-SYNC.md). Each run first
// expands community archives (DriveCommunityService), then for each source,
// oldest sync first, within a time slice of min(remaining run budget,
// DRIVE_SYNC_SOURCE_BUDGET):
//
//   1. files.get(root): 404/403 -> REVOKED (everything unpublished).
//   2. Resumable BFS walk (DriveWalker) for at most HALF the slice, from the
//      persisted frontier of the current generation (a new generation starts
//      at the root once the previous one completed). Shortcuts and loops:
//      see DriveWalker.
//   3. DriveSyncStore.applyWalk: upsert what was found (seen_generation),
//      save the frontier; only when the generation completes cleanly are rows
//      not seen in it marked REMOVED. Then recompute subjects/publication.
//   4. Fetch content for the rest of the slice: every row of the source whose
//      stored content is missing or outdated (DriveSyncStore.pendingTasks),
//      so files found by earlier slices are fetched even while the walk is
//      unfinished. Per-file errors set drive_file.sync_error.
//
// lastSyncedAt is set at the end of every slice (also PARTIAL), so a source
// whose walk or fetch is unfinished rotates to the back of the queue.
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
    private final DriveCommunityService community;
    private final DriveSyncProperties props;
    private final Clock clock;
    private final Set<UUID> inProgress = ConcurrentHashMap.newKeySet();

    public DriveSyncService(DriveClient drive, DriveSyncStore store, DriveContentProcessor processor,
                            DriveCommunityService community, DriveSyncProperties props, Clock clock) {
        this.drive = drive;
        this.store = store;
        this.processor = processor;
        this.community = community;
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
            try {
                community.expandAll();
            } catch (DriveApiException e) {
                log.warn("Drive sync: community expansion failed: {} {}", e.status(), e.getMessage());
                if (e.isRateLimited()) return;
            } catch (RuntimeException e) {
                log.warn("Drive sync: community expansion failed", e);
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

        var now = clock.instant();
        var sliceEnd = min(deadline, now.plus(props.sourceBudget()));
        var walkEnd = now.plus(Duration.between(now, sliceEnd).dividedBy(2));

        var walker = new DriveWalker(drive, clock, props.maxItemsPerSource(), props.maxDepth());
        DriveWalker.Result result;
        long generation;
        try {
            var state = store.resumeWalk(source.id()).orElse(null);
            if (state == null) state = store.startWalk(source.id(), root.id(), walker.rootAncestors(root));
            generation = state.generation();
            var ctx = new DriveWalker.Context(root.id(), source.ownerEmail(), source.community(),
                source.communityRootFolderId(), new HashSet<>(state.rootAncestors()));
            result = walker.walk(ctx, state.frontier(), state.seen(), walkEnd);
        } catch (DriveApiException e) {
            return fail(source, e);
        }
        if (result.skippedShortcuts() > 0) {
            log.info("Drive sync: source {}: skipped {} shortcuts (unreadable, not owned, above the root or "
                + "into another community folder)", source.id(), result.skippedShortcuts());
        }

        // Disconnected, blocked or deleted while we walked: nothing applied.
        if (!store.applyWalk(source.id(), root.name(), result, generation)) return Outcome.SKIPPED;

        var tasks = store.pendingTasks(source.id());
        boolean allFetched = true;
        int fetched = 0;
        for (var task : tasks) {
            if (clock.instant().isAfter(sliceEnd)) {
                allFetched = false;
                break;
            }
            try {
                var content = processor.process(new DriveContentProcessor.Request(task.fileId(),
                        task.driveId(), task.kind(), task.name(), task.mimeType(), task.version(),
                        task.knownFingerprint(), task.size(), task.reference()),
                    fp -> store.hasCopy(task.fileId(), task.driveId(), fp));
                fetched++;
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
        boolean done = result.done() && allFetched;
        log.info("Drive sync: source {} generation {}: {} items walked, {} folders left, {}/{} fetched, done={}",
            source.id(), generation, result.walked().size(), result.frontier().size(), fetched, tasks.size(), done);
        return done ? Outcome.SYNCED : Outcome.PARTIAL;
    }

    private static Instant min(Instant a, Instant b) {
        return a.isBefore(b) ? a : b;
    }

    private Outcome fail(DriveSyncStore.Snapshot source, DriveApiException e) {
        log.warn("Drive sync: source {} failed: {} {} {}", source.id(), e.status(), e.reason(), e.getMessage());
        store.recordFailure(source.id(), "Google Drive error " + e.status() + (e.reason() == null ? "" : " " + e.reason()));
        return e.isRateLimited() ? Outcome.RATE_LIMITED : Outcome.FAILED;
    }
}
