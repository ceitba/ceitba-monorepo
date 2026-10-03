package org.ceitba.api.service.drive;

import org.ceitba.api.domain.drive.DriveFile;
import org.ceitba.api.domain.drive.DriveFileKind;
import org.ceitba.api.domain.drive.DriveSource;
import org.ceitba.api.domain.drive.DriveSourceKind;
import org.ceitba.api.domain.drive.DriveSourceStatus;
import org.ceitba.api.domain.drive.DriveSourceWalk;
import org.ceitba.api.domain.drive.DriveStorageMode;
import org.ceitba.api.config.DriveSyncProperties;
import org.ceitba.api.domain.drive.DriveUnclaimedShare;
import org.ceitba.api.external.drive.DriveItem;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.repository.drive.DriveFileRepository;
import org.ceitba.api.repository.drive.DriveSourceRepository;
import org.ceitba.api.repository.drive.DriveSourceWalkRepository;
import org.ceitba.api.repository.drive.DriveUnclaimedShareRepository;
import org.ceitba.api.service.kb.KbModerationService;
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
//   missing             only when a walk GENERATION completes cleanly (rows
//                       not seen in it): REMOVED, purged in 30 days
// A walk is applied slice by slice (DriveWalker): each slice upserts what it
// found and saves the frontier (drive_source_walk). Content fetches are
// computed from the rows (pendingTasks), so a slice also fetches what
// earlier slices found.
// Community sources: every file counts as the community's (owned_by_sharer
// true, owner_email never stored), no cross-source moves.
// Cross-source move (same student): an item that left source A and showed up
// in source B keeps its row (id, stored copy, explicit subject). Whichever
// source syncs first, the older row survives: B adopts A's row when A
// already marked it removed; A, when it finds the item missing while B holds
// a live row for it, moves its row into B and drops B's newer one.
//
// applyWalk and storeContent lock the source row and give up when it is gone,
// DISCONNECTED or BLOCKED: a disconnect, block or account deletion that lands
// mid-sync is never undone by the rest of that sync.
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
    private final KbModerationService kb;
    private final DriveSourceWalkRepository walks;
    private final DriveSyncProperties props;
    private final Clock clock;

    public DriveSyncStore(DriveSourceRepository sources, DriveFileRepository files,
                          DriveUnclaimedShareRepository unclaimed, UserRepository users,
                          DriveRecalculator recalculator, DriveBlobs blobs, DriveStorageJanitor janitor,
                          KbModerationService kb, DriveSourceWalkRepository walks, DriveSyncProperties props,
                          Clock clock) {
        this.walks = walks;
        this.props = props;
        this.sources = sources;
        this.files = files;
        this.unclaimed = unclaimed;
        this.users = users;
        this.recalculator = recalculator;
        this.blobs = blobs;
        this.janitor = janitor;
        this.kb = kb;
        this.clock = clock;
    }

    // ownerEmail: the student's, or the community archive's owner.
    // communityRootFolderId: the archive's root folder (community sources).
    public record Snapshot(UUID id, String rootFolderId, String ownerEmail, DriveSourceStatus status,
                           boolean community, String communityRootFolderId) {}

    // The current walk generation of a source: the folders still to list and
    // the ids already reached in it.
    public record WalkState(long generation, List<String> frontier, List<String> seen, List<String> rootAncestors) {}

    // An item found by the walk. parentDriveId is null for direct children of
    // the root; shortcuts are already resolved to their target.
    public record WalkedItem(DriveItem item, String parentDriveId, DriveFileKind kind) {}

    // knownFingerprint: md5-based, binary files only. modifiedAt: the
    // item's modifiedTime, recorded as content_modified_at once checked.
    // reference: fetch by reference (text only, no stored binaries).
    public record FetchTask(UUID fileId, String driveId, DriveFileKind kind, String name, String mimeType,
                            Long version, String knownFingerprint, Long size, OffsetDateTime modifiedAt,
                            boolean reference) {}

    @Transactional(readOnly = true)
    public List<UUID> idsToSync() {
        return sources.findIdsToSync(SYNCABLE);
    }

    // Manual syncs may also retry a REVOKED source (the student shared it again).
    @Transactional(readOnly = true)
    public Optional<Snapshot> snapshot(UUID sourceId, boolean allowRevoked) {
        return sources.findById(sourceId)
            .filter(s -> s.getKind() != DriveSourceKind.COMMUNITY_ROOT)
            .filter(s -> SYNCABLE.contains(s.getStatus()) || (allowRevoked && s.getStatus() == DriveSourceStatus.REVOKED))
            .map(s -> {
                if (s.isCommunity()) {
                    var root = s.getParentSourceId() == null ? null : sources.findById(s.getParentSourceId()).orElse(null);
                    return new Snapshot(s.getId(), s.getRootFolderId(), s.getOwnerEmail(), s.getStatus(), true,
                        root == null ? null : root.getRootFolderId());
                }
                return new Snapshot(s.getId(), s.getRootFolderId(),
                    users.findById(s.getUserId()).map(u -> u.getEmail()).orElse(null), s.getStatus(), false, null);
            });
    }

    // The generation in progress, or empty when none (never walked, or the
    // last one completed): then the caller starts one (startWalk).
    @Transactional(readOnly = true)
    public Optional<WalkState> resumeWalk(UUID sourceId) {
        return walks.findById(sourceId)
            .filter(w -> !w.isCompleted())
            .map(w -> new WalkState(w.getGeneration(), w.getFrontier(),
                files.findDriveIdsSeenIn(sourceId, w.getGeneration()), w.getRootAncestors()));
    }

    // A new generation from the root.
    @Transactional
    public WalkState startWalk(UUID sourceId, String rootFolderId, List<String> rootAncestors) {
        var walk = walks.findById(sourceId).orElseGet(() -> new DriveSourceWalk(sourceId));
        long generation = walk.getGeneration() + 1;
        walk.start(generation, now(), List.of(DriveWalker.entry(0, rootFolderId)), rootAncestors);
        walks.save(walk);
        return new WalkState(generation, walk.getFrontier(), List.of(), walk.getRootAncestors());
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

    // Whether a sync may still write into the source (REVOKED counts: a
    // manual sync may retry it).
    static boolean writable(DriveSource s) {
        return s.getStatus() != DriveSourceStatus.DISCONNECTED && s.getStatus() != DriveSourceStatus.BLOCKED;
    }

    @Transactional(readOnly = true)
    public boolean isSyncable(UUID sourceId) {
        return sources.findById(sourceId).filter(DriveSyncStore::writable).isPresent();
    }

    // Applies one walk slice (see the class comment): upserts the items found
    // (seen in `generation`), saves the frontier, and when the generation is
    // done marks it completed and, unless it was incomplete, removes the rows
    // it did not reach. False (nothing applied) when the source is gone or no
    // longer writable.
    @Transactional
    public boolean applyWalk(UUID sourceId, String rootName, DriveWalker.Result slice, long generation) {
        var source = sources.findByIdForUpdate(sourceId).filter(DriveSyncStore::writable).orElse(null);
        if (source == null) return false;
        if (rootName != null && !rootName.equals(source.getRootName())) source.setRootName(rootName);
        var walk = walks.findById(sourceId).orElseGet(() -> new DriveSourceWalk(sourceId));
        if (walk.getGeneration() != generation) return false;
        var now = now();
        boolean community = source.isCommunity();
        String ownerEmail = community ? source.getOwnerEmail() : users.findById(source.getUserId())
            .map(u -> u.getEmail()).orElse(null);

        Map<String, DriveFile> existing = new HashMap<>();
        for (var f : files.findBySourceId(sourceId)) existing.put(f.getDriveId(), f);

        var seen = new HashSet<String>();
        for (var w : slice.walked()) {
            var item = w.item();
            // The same item reached twice (shortcut + original, cycles): first path wins.
            if (!seen.add(item.id())) continue;
            var f = existing.get(item.id());
            if (f == null && !community) f = adoptFromOtherSource(item.id(), source).orElse(null);
            if (f == null) {
                f = files.save(newFile(sourceId, w, ownerEmail, community));
                existing.put(item.id(), f);
            } else {
                applyMetadata(f, w, ownerEmail, community);
            }
            if (f.isRemovedFromDrive()) f.setRemoved(null, null);
            f.setSeenGeneration(generation);
        }

        walk.setFrontier(slice.frontier());
        if (slice.incomplete()) walk.markIncomplete(slice.warning());
        var otherSources = new HashSet<UUID>();
        if (slice.done()) {
            walk.setCompletedAt(now);
            if (!walk.isIncomplete()) {
                for (var f : existing.values()) {
                    if (!removable(f, generation)) continue;
                    var target = community ? null : moveToOtherSource(f, source);
                    if (target != null) {
                        otherSources.add(target);
                        continue;
                    }
                    f.setRemoved(now, now.plus(PURGE_DELAY));
                }
            }
        }
        walks.save(walk);
        recalculator.recompute(source, files.findBySourceId(sourceId));
        for (var other : sources.findAllById(otherSources)) {
            recalculator.recompute(other, files.findBySourceId(other.getId()));
        }
        return true;
    }

    // After a clean, complete generation: a live row it did not reach.
    static boolean removable(DriveFile f, long generation) {
        return !f.isRemovedFromDrive() && (f.getSeenGeneration() == null || f.getSeenGeneration() != generation);
    }

    // Rows whose stored content is missing or outdated (by the metadata the
    // walk recorded), files that failed last time at the end.
    @Transactional(readOnly = true)
    public List<FetchTask> pendingTasks(UUID sourceId) {
        var source = sources.findById(sourceId).orElse(null);
        if (source == null) return List.of();
        var tasks = new ArrayList<FetchTask>();
        var failed = new ArrayList<FetchTask>();
        for (Object[] r : files.fetchCandidates(sourceId)) {
            var row = new Candidate((UUID) r[0], (String) r[1], (DriveFileKind) r[2], (String) r[3], (String) r[4],
                (Long) r[5], (String) r[6], (Long) r[7], (OffsetDateTime) r[8], (String) r[9], (Long) r[10],
                (OffsetDateTime) r[11], (Boolean) r[12], (Boolean) r[13]);
            boolean reference = byReference(source.getStorageMode(), row.size(), props.referenceAboveBytes());
            if (!needsFetch(row, reference)) continue;
            var md5 = row.md5() == null ? null : "md5:" + row.md5();
            var task = new FetchTask(row.id(), row.driveId(), row.kind(), row.name(), row.mimeType(), row.version(),
                md5, row.size(), row.modifiedAt(), reference);
            if (Boolean.TRUE.equals(r[14])) failed.add(task); else tasks.add(task);
        }
        tasks.addAll(failed);
        return tasks;
    }

    // REFERENCE sources, and any file above DRIVE_SYNC_REFERENCE_ABOVE_BYTES,
    // keep no binary copy.
    static boolean byReference(DriveStorageMode mode, Long size, long referenceAboveBytes) {
        return mode == DriveStorageMode.REFERENCE || (size != null && size > referenceAboveBytes);
    }

    // The fetch-relevant columns of a row (DriveFileRepository.fetchCandidates).
    record Candidate(UUID id, String driveId, DriveFileKind kind, String name, String mimeType, Long version,
                     String md5, Long size, OffsetDateTime modifiedAt, String fingerprint, Long contentVersion,
                     OffsetDateTime contentModifiedAt, boolean exportBlocked, boolean byReference) {}

    private static DriveFile newFile(UUID sourceId, WalkedItem w, String ownerEmail, boolean community) {
        var f = new DriveFile(sourceId, w.item().id());
        applyMetadata(f, w, ownerEmail, community);
        return f;
    }

    // Community files all count as the community's; their Drive owner (a
    // personal Gmail) is never stored.
    private static void applyMetadata(DriveFile f, WalkedItem w, String ownerEmail, boolean community) {
        var item = w.item();
        f.setMetadata(w.parentDriveId(), item.name(), item.mimeType(), w.kind(),
            community ? null : item.firstOwner(), community || item.ownedBy(ownerEmail), item.version(),
            item.md5Checksum(), item.size(), at(item));
        f.setDriveCreatedAt(item.createdTime() == null ? null : item.createdTime().atOffset(ZoneOffset.UTC));
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
        f.setDriveCreatedAt(live.getDriveCreatedAt());
        f.applyHiddenDefault();
        if (f.getSubjectId() == null) f.setSubjectId(live.getSubjectId());
        if (!f.hasContent() && live.hasContent()) copyContent(live, f);
        var dropped = DriveBlobs.Ref.of(live);
        var droppedId = live.getId();
        kb.forgetFiles(List.of(droppedId));
        files.delete(live);
        files.flush();
        f.moveTo(target);
        janitor.deleteAfterCommit(blobs.releasable(List.of(dropped), List.of(droppedId)));
        return target;
    }

    // Reference rows' fingerprints carry this prefix, so a reference row and
    // a stored copy of the same content never pass for each other (blob
    // release counts holders by fingerprint).
    static final String REF = "ref:";

    static boolean needsFetch(Candidate f, boolean reference) {
        if (f.fingerprint() == null) return true;
        // Storage mode changed (source mode or size threshold): fetch again.
        if (f.byReference() != reference) return true;
        // Download disabled by the owner: retried whenever Drive reports any
        // change (re-enabling it may not touch modifiedTime).
        if (f.exportBlocked()) return !Objects.equals(f.version(), f.contentVersion());
        if (f.md5() != null) return !((reference ? REF : "") + "md5:" + f.md5()).equals(f.fingerprint());
        if (f.modifiedAt() == null) return !Objects.equals(f.version(), f.contentVersion());
        return !Objects.equals(f.modifiedAt(), f.contentModifiedAt());
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
        to.setByReference(from.isByReference());
        to.setContentModifiedAt(from.getContentModifiedAt());
        to.setExportBlocked(from.isExportBlocked());
    }

    // Saves a checked copy; the previous copy's objects go after commit when
    // no other row shares them. An `existing` result keeps (same
    // fingerprint) or shares (another row's) a stored copy: no new objects.
    // False when the row or its source is gone (or the source is no longer
    // writable): the objects just uploaded for it are deleted unless another
    // row holds the same copy.
    @Transactional
    public boolean storeContent(UUID sourceId, UUID fileId, String driveId, DriveContentProcessor.Content c,
                                OffsetDateTime modifiedAt) {
        var source = sources.findByIdForUpdate(sourceId).filter(DriveSyncStore::writable).orElse(null);
        var f = source == null ? null : files.findById(fileId).filter(r -> r.getSourceId().equals(sourceId)).orElse(null);
        if (f == null) {
            if (!c.existing()) {
                janitor.deleteAfterCommit(blobs.releasable(
                    List.of(new DriveBlobs.Ref(driveId, c.fingerprint(), keysOf(c))), List.of(fileId)));
            }
            return false;
        }
        f.setSyncError(null);
        if (c.existing()) {
            if (Objects.equals(f.getContentFingerprint(), c.fingerprint()) || reuseContent(f, c.fingerprint())) {
                f.setContentVersion(c.version());
                f.setContentModifiedAt(modifiedAt);
            } else {
                // The other holder vanished meanwhile: check again next sync.
                f.setContentModifiedAt(null);
            }
            return true;
        }
        var old = DriveBlobs.Ref.of(f);
        f.setContent(c.version(), c.fingerprint(), c.html(), c.pdfKey(), c.originalKey(), c.originalContentType(),
            c.assetPrefix(), c.assetNames(), c.text(), c.metadataOnly());
        f.setByReference(c.byReference());
        f.setExportBlocked(c.exportBlocked());
        f.setContentModifiedAt(modifiedAt);
        if (!Objects.equals(old.fingerprint(), c.fingerprint())) {
            janitor.deleteAfterCommit(blobs.releasable(List.of(old), List.of()));
        }
        return true;
    }

    // The object keys a processed copy uploaded (same rule as DriveFile.storageKeys).
    static List<String> keysOf(DriveContentProcessor.Content c) {
        var keys = new ArrayList<String>();
        if (c.pdfKey() != null) keys.add(c.pdfKey());
        if (c.originalKey() != null && !c.originalKey().equals(c.pdfKey())) keys.add(c.originalKey());
        if (c.assetPrefix() != null && c.assetNames() != null) {
            for (var n : c.assetNames()) keys.add(c.assetPrefix() + n);
        }
        return keys;
    }

    @Transactional
    public void storeError(UUID fileId, String error) {
        files.findById(fileId).ifPresent(f -> f.setSyncError(truncate(error)));
    }

    // A slice finished (also a partial one, so it rotates to the back of the
    // queue): clears the failure streak; an ERROR or REVOKED source that
    // works again goes back to ACTIVE (approved) or PENDING_REVIEW. A walk
    // warning (a cap was hit) is kept as last_error.
    @Transactional
    public void finishSync(UUID sourceId) {
        var warning = walks.findById(sourceId).map(DriveSourceWalk::getWarning).orElse(null);
        sources.findById(sourceId).ifPresent(s -> {
            s.setLastSyncedAt(now());
            s.setLastError(truncate(warning));
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
        kb.forgetFiles(ids);
        files.deleteAll(expired);
        janitor.deleteAfterCommit(blobs.releasable(refs, ids));
    }

    // ---- Community archives (DriveCommunityService) ------------------------

    public record CommunityRoot(UUID id, String rootFolderId) {}

    // A top-level folder of an archive to keep as a COMMUNITY source.
    public record CommunityFolder(String folderId, String name, String subjectId) {}

    @Transactional(readOnly = true)
    public List<CommunityRoot> activeCommunityRoots() {
        return sources.findByKindAndStatus(DriveSourceKind.COMMUNITY_ROOT, DriveSourceStatus.ACTIVE).stream()
            .map(s -> new CommunityRoot(s.getId(), s.getRootFolderId()))
            .toList();
    }

    // Makes the archive's COMMUNITY sources match `folders`: new folders get
    // a source (ACTIVE, approved, the root's label and storage mode; the
    // next run syncs it), existing ones follow renames and subject changes
    // and come back when they had been disconnected, folders that left the
    // listing are disconnected (rows and copies deleted). BLOCKED sources are
    // left alone. Returns [created, disconnected].
    @Transactional
    public int[] applyCommunityFolders(UUID rootId, String ownerEmail, List<CommunityFolder> folders) {
        var root = sources.findByIdForUpdate(rootId)
            .filter(r -> r.getKind() == DriveSourceKind.COMMUNITY_ROOT && r.getStatus() == DriveSourceStatus.ACTIVE)
            .orElse(null);
        if (root == null) return new int[] {0, 0};
        if (ownerEmail != null && !ownerEmail.equalsIgnoreCase(String.valueOf(root.getOwnerEmail()))) {
            root.setOwnerEmail(ownerEmail);
        }
        var now = now();
        Map<String, DriveSource> children = new HashMap<>();
        for (var c : sources.findByParentSourceId(rootId)) children.put(c.getRootFolderId(), c);
        int created = 0;
        int disconnected = 0;
        var listed = new HashSet<String>();
        for (var folder : folders) {
            listed.add(folder.folderId());
            var child = children.get(folder.folderId());
            if (child == null) {
                sources.save(DriveSource.community(root, folder.folderId(), folder.name(), folder.subjectId(), now));
                created++;
                continue;
            }
            if (child.getStatus() == DriveSourceStatus.BLOCKED) continue;
            child.setRootName(folder.name());
            child.setOwnerEmail(root.getOwnerEmail());
            child.setDisplayName(root.getDisplayName());
            if (child.getStatus() == DriveSourceStatus.DISCONNECTED) {
                child.setStatus(DriveSourceStatus.ACTIVE);
                child.setConsecutiveFailures(0);
                child.setLastError(null);
                if (child.getApprovedAt() == null) child.setApprovedAt(now);
            }
            if (!Objects.equals(child.getSubjectId(), folder.subjectId())) {
                child.setSubjectId(folder.subjectId());
                recalculator.recompute(child, files.findBySourceId(child.getId()));
            }
        }
        for (var child : children.values()) {
            if (listed.contains(child.getRootFolderId())) continue;
            if (child.getStatus() == DriveSourceStatus.DISCONNECTED || child.getStatus() == DriveSourceStatus.BLOCKED) {
                continue;
            }
            child.setStatus(DriveSourceStatus.DISCONNECTED);
            dropAllFiles(child.getId());
            disconnected++;
        }
        return new int[] {created, disconnected};
    }

    // Every row of a source goes now, its unshared objects after commit;
    // wiki pages citing them are hidden and their LLM data dropped. The walk
    // starts over if the source comes back.
    private void dropAllFiles(UUID sourceId) {
        var all = files.findBySourceId(sourceId);
        var refs = all.stream().map(DriveBlobs.Ref::of).toList();
        var ids = all.stream().map(DriveFile::getId).toList();
        kb.forgetFiles(ids);
        files.deleteAll(all);
        walks.findById(sourceId).ifPresent(walks::delete);
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
