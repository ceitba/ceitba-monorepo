package org.ceitba.api.service.drive;

import org.ceitba.api.domain.drive.DriveFile;
import org.ceitba.api.domain.drive.DriveFileKind;
import org.ceitba.api.domain.drive.DriveSource;
import org.ceitba.api.domain.drive.DriveSourceStatus;
import org.ceitba.api.domain.drive.DriveUnclaimedShare;
import org.ceitba.api.external.drive.DriveItem;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.repository.drive.DriveFileRepository;
import org.ceitba.api.repository.drive.DriveSourceRepository;
import org.ceitba.api.repository.drive.DriveUnclaimedShareRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

// The short transactions of a sync (DriveSyncService does the Drive and
// storage I/O between them, never inside a transaction).
//
// Diff of a walk against the source's rows, by drive_id:
//   new                 insert (or adopt the student's row from another
//                       source, see below) and fetch
//   binary, md5 changed download
//   Google file, modifiedTime changed
//                       export and hash (DriveContentProcessor); stored again
//                       only when the hash differs (a renamed Doc bumps
//                       modifiedTime but keeps its hash: no new objects)
//   renamed / moved     metadata only: same row id, path and effective
//                       subject recomputed
//   missing             only after a COMPLETE walk: REMOVED, purged in 30 days
// Cross-source move (same student): an item that left source A and showed up
// in source B keeps its row (id, stored copy, explicit subject). Whichever
// source syncs first, the older row survives: B adopts A's row when A
// already marked it removed; A, when it finds the item missing while B holds
// a live row for it, moves its row into B and drops B's newer one.
@Service
public class DriveSyncStore {

    static final int MAX_CONSECUTIVE_FAILURES = 5;
    static final Duration PURGE_DELAY = Duration.ofDays(30);
    static final int MAX_ERROR_CHARS = 1000;

    private static final Set<DriveSourceStatus> SYNCABLE =
        Set.of(DriveSourceStatus.ACTIVE, DriveSourceStatus.PENDING_REVIEW, DriveSourceStatus.ERROR);

    private final DriveSourceRepository sources;
    private final DriveFileRepository files;
    private final DriveUnclaimedShareRepository unclaimed;
    private final UserRepository users;
    private final DriveRecalculator recalculator;
    private final DriveBlobs blobs;
    private final DriveStorageJanitor janitor;
    private final Clock clock;

    public DriveSyncStore(DriveSourceRepository sources, DriveFileRepository files,
                          DriveUnclaimedShareRepository unclaimed, UserRepository users,
                          DriveRecalculator recalculator, DriveBlobs blobs, DriveStorageJanitor janitor,
                          Clock clock) {
        this.sources = sources;
        this.files = files;
        this.unclaimed = unclaimed;
        this.users = users;
        this.recalculator = recalculator;
        this.blobs = blobs;
        this.janitor = janitor;
        this.clock = clock;
    }

    public record Snapshot(UUID id, String rootFolderId, String ownerEmail, DriveSourceStatus status) {}

    // An item found by the walk. parentDriveId is null for direct children of
    // the root; shortcuts are already resolved to their target.
    public record WalkedItem(DriveItem item, String parentDriveId, DriveFileKind kind) {}

    // knownFingerprint: md5-based, binary files only. modifiedAt: the
    // item's modifiedTime, recorded as content_modified_at once checked.
    public record FetchTask(UUID fileId, String driveId, DriveFileKind kind, String name, String mimeType,
                            Long version, String knownFingerprint, Long size, OffsetDateTime modifiedAt) {}

    @Transactional(readOnly = true)
    public List<UUID> idsToSync() {
        return sources.findIdsToSync(SYNCABLE);
    }

    // Manual syncs may also retry a REVOKED source (the student shared it again).
    @Transactional(readOnly = true)
    public Optional<Snapshot> snapshot(UUID sourceId, boolean allowRevoked) {
        return sources.findById(sourceId)
            .filter(s -> SYNCABLE.contains(s.getStatus()) || (allowRevoked && s.getStatus() == DriveSourceStatus.REVOKED))
            .map(s -> new Snapshot(s.getId(), s.getRootFolderId(),
                users.findById(s.getUserId()).map(u -> u.getEmail()).orElse(null), s.getStatus()));
    }

    // The bot lost access to the root: nothing stays published.
    @Transactional
    public void markRevoked(UUID sourceId, String error) {
        sources.findById(sourceId).ifPresent(s -> {
            if (s.getStatus() == DriveSourceStatus.DISCONNECTED || s.getStatus() == DriveSourceStatus.BLOCKED) return;
            s.setStatus(DriveSourceStatus.REVOKED);
            s.setLastError(truncate(error));
            s.setLastSyncedAt(now());
            recalculator.recompute(s, files.findBySourceId(sourceId));
        });
    }

    @Transactional
    public void recordFailure(UUID sourceId, String error) {
        sources.findById(sourceId).ifPresent(s -> {
            s.setLastError(truncate(error));
            s.setConsecutiveFailures(s.getConsecutiveFailures() + 1);
            if (s.getConsecutiveFailures() >= MAX_CONSECUTIVE_FAILURES && SYNCABLE.contains(s.getStatus())) {
                s.setStatus(DriveSourceStatus.ERROR);
            }
        });
    }

    // Applies a walk (see the class comment) and returns the files whose
    // stored copy is missing or outdated.
    @Transactional
    public List<FetchTask> applyWalk(UUID sourceId, String rootName, List<WalkedItem> walked, boolean complete,
                                     String ownerEmail) {
        var source = sources.findById(sourceId).orElseThrow(() -> DriveAccess.sourceNotFound(sourceId));
        if (rootName != null && !rootName.equals(source.getRootName())) source.setRootName(rootName);
        var now = now();

        Map<String, DriveFile> existing = new HashMap<>();
        for (var f : files.findBySourceId(sourceId)) existing.put(f.getDriveId(), f);

        var seen = new HashSet<String>();
        var all = new ArrayList<DriveFile>();
        var walkedById = new HashMap<String, WalkedItem>();
        for (var w : walked) {
            var item = w.item();
            // The same item reached twice (shortcut + original, cycles): first path wins.
            if (!seen.add(item.id())) continue;
            walkedById.put(item.id(), w);
            var f = existing.get(item.id());
            if (f == null) f = adoptFromOtherSource(item.id(), source).orElse(null);
            if (f == null) f = files.save(newFile(sourceId, w, ownerEmail));
            else applyMetadata(f, w, ownerEmail);
            if (f.isRemovedFromDrive()) f.setRemoved(null, null);
            all.add(f);
        }

        var otherSources = new HashSet<UUID>();
        for (var f : existing.values()) {
            if (seen.contains(f.getDriveId())) continue;
            if (complete && !f.isRemovedFromDrive()) {
                var target = moveToOtherSource(f, source);
                if (target != null) {
                    otherSources.add(target);
                    continue;
                }
                f.setRemoved(now, now.plus(PURGE_DELAY));
            }
            all.add(f);
        }
        recalculator.recompute(source, all);
        for (var other : sources.findAllById(otherSources)) {
            recalculator.recompute(other, files.findBySourceId(other.getId()));
        }

        var tasks = new ArrayList<FetchTask>();
        for (var f : all) {
            var w = walkedById.get(f.getDriveId());
            if (w == null || w.kind() == DriveFileKind.FOLDER) continue;
            if (needsFetch(f, w.item())) {
                var item = w.item();
                tasks.add(new FetchTask(f.getId(), f.getDriveId(), w.kind(), item.name(), item.mimeType(),
                    item.version(), item.binaryFingerprint(), item.size(), at(item)));
            }
        }
        return tasks;
    }

    private static DriveFile newFile(UUID sourceId, WalkedItem w, String ownerEmail) {
        var f = new DriveFile(sourceId, w.item().id());
        applyMetadata(f, w, ownerEmail);
        return f;
    }

    private static void applyMetadata(DriveFile f, WalkedItem w, String ownerEmail) {
        var item = w.item();
        f.setMetadata(w.parentDriveId(), item.name(), item.mimeType(), w.kind(), item.firstOwner(),
            item.ownedBy(ownerEmail), item.version(), item.md5Checksum(), item.size(), at(item));
        f.applyHiddenDefault();
    }

    // A row of this item that another source of the same student marked
    // removed (the item moved here): moved into this source, id kept.
    private Optional<DriveFile> adoptFromOtherSource(String driveId, DriveSource source) {
        var candidate = files.findInOtherSourcesOfUser(driveId, source.getUserId(), source.getId()).stream()
            .filter(DriveFile::isRemovedFromDrive)
            .findFirst();
        candidate.ifPresent(f -> f.moveTo(source.getId()));
        return candidate;
    }

    // The item left this source and another source of the same student
    // already holds a live row for it: this (older) row moves there and
    // takes over, keeping its id; the newer row is dropped. Returns the
    // target source id, or null when there is no such row.
    private UUID moveToOtherSource(DriveFile f, DriveSource source) {
        var live = files.findInOtherSourcesOfUser(f.getDriveId(), source.getUserId(), source.getId()).stream()
            .filter(o -> !o.isRemovedFromDrive())
            .findFirst()
            .orElse(null);
        if (live == null) return null;
        var target = live.getSourceId();
        f.setMetadata(live.getParentDriveId(), live.getName(), live.getMimeType(), live.getKind(),
            live.getOwnerEmail(), live.isOwnedBySharer(), live.getDriveVersion(), live.getMd5Checksum(),
            live.getSizeBytes(), live.getDriveModifiedAt());
        f.applyHiddenDefault();
        if (f.getSubjectId() == null) f.setSubjectId(live.getSubjectId());
        if (!f.hasContent() && live.hasContent()) copyContent(live, f);
        var dropped = DriveBlobs.Ref.of(live);
        var droppedId = live.getId();
        files.delete(live);
        files.flush();
        f.moveTo(target);
        janitor.deleteAfterCommit(blobs.releasable(List.of(dropped), List.of(droppedId)));
        return target;
    }

    static boolean needsFetch(DriveFile f, DriveItem item) {
        if (!f.hasContent()) return true;
        // Download disabled by the owner: retried whenever Drive reports any
        // change (re-enabling it may not touch modifiedTime).
        if (f.isExportBlocked()) return !Objects.equals(item.version(), f.getContentVersion());
        if (item.binaryFingerprint() != null) return !item.binaryFingerprint().equals(f.getContentFingerprint());
        if (item.modifiedTime() == null) return !Objects.equals(item.version(), f.getContentVersion());
        return !Objects.equals(at(item), f.getContentModifiedAt());
    }

    // Whether a stored copy with this fingerprint exists: the row's own
    // current one, or another row's (then storeContent shares it).
    @Transactional(readOnly = true)
    public boolean hasCopy(UUID fileId, String driveId, String fingerprint) {
        var own = files.findById(fileId).map(DriveFile::getContentFingerprint).orElse(null);
        return fingerprint.equals(own) || !files.findContentHolders(driveId, fingerprint, fileId).isEmpty();
    }

    // Shares another row's stored copy of the same content (the same file in
    // another student's source). False when no row holds it.
    private boolean reuseContent(DriveFile f, String fingerprint) {
        var holder = files.findContentHolders(f.getDriveId(), fingerprint, f.getId()).stream().findFirst().orElse(null);
        if (holder == null) return false;
        var old = DriveBlobs.Ref.of(f);
        copyContent(holder, f);
        if (!Objects.equals(old.fingerprint(), fingerprint)) {
            janitor.deleteAfterCommit(blobs.releasable(List.of(old), List.of()));
        }
        return true;
    }

    // The stored HTML points its images at /files/<row id>/assets/: rewritten
    // for the receiving row.
    private static void copyContent(DriveFile from, DriveFile to) {
        var html = from.getHtmlContent() == null ? null : from.getHtmlContent().replace(
            "/api/v1/wiki/files/" + from.getId() + "/assets/", "/api/v1/wiki/files/" + to.getId() + "/assets/");
        to.setContent(from.getContentVersion(), from.getContentFingerprint(), html, from.getPdfKey(),
            from.getOriginalKey(), from.getOriginalContentType(), from.getAssetPrefix(), from.getAssetNames(),
            from.getTextContent(), from.isMetadataOnly());
        to.setContentModifiedAt(from.getContentModifiedAt());
        to.setExportBlocked(from.isExportBlocked());
    }

    // Saves a checked copy; the previous copy's objects go after commit when
    // no other row shares them. An `existing` result keeps (same
    // fingerprint) or shares (another row's) a stored copy: no new objects.
    @Transactional
    public void storeContent(UUID fileId, DriveContentProcessor.Content c, OffsetDateTime modifiedAt) {
        var f = files.findById(fileId).orElse(null);
        if (f == null) return;
        f.setSyncError(null);
        if (c.existing()) {
            if (Objects.equals(f.getContentFingerprint(), c.fingerprint()) || reuseContent(f, c.fingerprint())) {
                f.setContentVersion(c.version());
                f.setContentModifiedAt(modifiedAt);
            } else {
                // The other holder vanished meanwhile: check again next sync.
                f.setContentModifiedAt(null);
            }
            return;
        }
        var old = DriveBlobs.Ref.of(f);
        f.setContent(c.version(), c.fingerprint(), c.html(), c.pdfKey(), c.originalKey(), c.originalContentType(),
            c.assetPrefix(), c.assetNames(), c.text(), c.metadataOnly());
        f.setExportBlocked(c.exportBlocked());
        f.setContentModifiedAt(modifiedAt);
        if (!Objects.equals(old.fingerprint(), c.fingerprint())) {
            janitor.deleteAfterCommit(blobs.releasable(List.of(old), List.of()));
        }
    }

    @Transactional
    public void storeError(UUID fileId, String error) {
        files.findById(fileId).ifPresent(f -> f.setSyncError(truncate(error)));
    }

    // A walk finished: clears the failure streak; an ERROR or REVOKED source
    // that works again goes back to ACTIVE (approved) or PENDING_REVIEW.
    @Transactional
    public void finishSync(UUID sourceId) {
        sources.findById(sourceId).ifPresent(s -> {
            s.setLastSyncedAt(now());
            s.setLastError(null);
            s.setConsecutiveFailures(0);
            if (s.getStatus() == DriveSourceStatus.ERROR || s.getStatus() == DriveSourceStatus.REVOKED) {
                s.setStatus(s.getApprovedAt() != null ? DriveSourceStatus.ACTIVE : DriveSourceStatus.PENDING_REVIEW);
                recalculator.recompute(s, files.findBySourceId(sourceId));
            }
        });
    }

    // Files removed from Drive more than 30 days ago: rows go now, their
    // unshared objects after commit.
    @Transactional
    public void purgeExpired() {
        var expired = files.findByPurgeAfterBefore(now());
        if (expired.isEmpty()) return;
        var refs = expired.stream().map(DriveBlobs.Ref::of).toList();
        var ids = expired.stream().map(DriveFile::getId).toList();
        files.deleteAll(expired);
        janitor.deleteAfterCommit(blobs.releasable(refs, ids));
    }

    // Folders shared with the bot that no live source registers.
    @Transactional
    public void recordUnclaimed(List<DriveItem> sharedFolders) {
        var registered = new HashSet<>(sources.findRootFolderIdsWithStatusNot(DriveSourceStatus.DISCONNECTED));
        var now = now();
        for (var folder : sharedFolders) {
            if (registered.contains(folder.id())) continue;
            var name = folder.name() == null ? folder.id() : folder.name();
            unclaimed.findById(folder.id()).ifPresentOrElse(
                u -> u.seen(name, folder.firstOwner(), now),
                () -> unclaimed.save(new DriveUnclaimedShare(folder.id(), name, folder.firstOwner(), now)));
        }
        if (!registered.isEmpty()) unclaimed.deleteByDriveIdIn(registered);
    }

    private static OffsetDateTime at(DriveItem item) {
        return item.modifiedTime() == null ? null : item.modifiedTime().atOffset(ZoneOffset.UTC);
    }

    private OffsetDateTime now() {
        return OffsetDateTime.now(clock);
    }

    static String truncate(String s) {
        if (s == null) return null;
        return s.length() <= MAX_ERROR_CHARS ? s : s.substring(0, MAX_ERROR_CHARS);
    }
}
