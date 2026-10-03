package org.ceitba.api.service.drive;

import org.ceitba.api.common.exception.ExternalApiException;
import org.ceitba.api.common.exception.InvalidStateException;
import org.ceitba.api.common.exception.ValidationException;
import org.ceitba.api.domain.User;
import org.ceitba.api.domain.drive.DriveFile;
import org.ceitba.api.domain.drive.DriveSource;
import org.ceitba.api.domain.drive.DriveSourceStatus;
import org.ceitba.api.external.drive.DriveApiException;
import org.ceitba.api.external.drive.DriveClient;
import org.ceitba.api.repository.SubjectRepository;
import org.ceitba.api.repository.drive.DriveFileRepository;
import org.ceitba.api.repository.drive.DriveSourceRepository;
import org.ceitba.api.repository.drive.DriveUnclaimedShareRepository;
import org.ceitba.api.web.drive.dto.AcceptSuggestionsResponse;
import org.ceitba.api.web.drive.dto.DriveInfoResponse;
import org.ceitba.api.web.drive.dto.RegisterSourceRequest;
import org.ceitba.api.web.drive.dto.SourceResponse;
import org.ceitba.api.web.drive.dto.SourceTreeResponse;
import org.ceitba.api.web.drive.dto.TreeItemResponse;
import org.ceitba.api.web.drive.dto.UpdateFileRequest;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;

// The student side of Drive sync (/v1/me/drive). Every call needs the
// feature configured (else 503 DRIVE_SYNC_UNCONFIGURED); sources and files
// of other users answer 404.
@Service
public class DriveSourceService {

    static final Duration MANUAL_SYNC_COOLDOWN = Duration.ofMinutes(5);

    private final DriveSourceRepository sources;
    private final DriveFileRepository files;
    private final DriveUnclaimedShareRepository unclaimed;
    private final SubjectRepository subjects;
    private final DriveClient drive;
    private final DriveAccess access;
    private final DriveRecalculator recalculator;
    private final DriveViews views;
    private final DriveStorageJanitor janitor;
    private final DriveBlobs blobs;
    private final ApplicationEventPublisher events;
    private final Clock clock;

    public DriveSourceService(DriveSourceRepository sources, DriveFileRepository files,
                              DriveUnclaimedShareRepository unclaimed, SubjectRepository subjects,
                              DriveClient drive, DriveAccess access, DriveRecalculator recalculator,
                              DriveViews views, DriveStorageJanitor janitor, DriveBlobs blobs,
                              ApplicationEventPublisher events, Clock clock) {
        this.sources = sources;
        this.files = files;
        this.unclaimed = unclaimed;
        this.subjects = subjects;
        this.drive = drive;
        this.access = access;
        this.recalculator = recalculator;
        this.views = views;
        this.janitor = janitor;
        this.blobs = blobs;
        this.events = events;
        this.clock = clock;
    }

    public DriveInfoResponse info() {
        access.requireDriveAvailable();
        return new DriveInfoResponse(drive.botEmail(), DriveConsent.VERSION, DriveConsent.TEXT);
    }

    // Validates the folder (shared with the bot, owned by the caller), stores
    // the consent and queues an immediate sync. A student with an ACTIVE
    // source is trusted: new sources start ACTIVE. Re-registering a REVOKED
    // source reactivates it.
    @Transactional
    public SourceResponse register(User user, RegisterSourceRequest req) {
        access.requireDriveAvailable();
        var folderId = DriveFolderUrls.parse(req.folderUrl())
            .orElseThrow(() -> new DriveException(DriveException.Reason.INVALID_FOLDER_URL,
                "Not a Google Drive folder link"));
        if (!DriveConsent.VERSION.equals(req.consentVersion())) {
            throw new ValidationException("consentVersion", req.consentVersion(),
                "must be the current consent version " + DriveConsent.VERSION);
        }
        var existing = sources.findFirstByUserIdAndRootFolderIdAndStatusNot(
            user.getId(), folderId, DriveSourceStatus.DISCONNECTED);
        if (existing.isPresent() && existing.get().getStatus() != DriveSourceStatus.REVOKED) {
            throw new DriveException(DriveException.Reason.SOURCE_EXISTS, "This folder is already connected");
        }

        var folder = fetchFolder(folderId);
        if (!folder.isFolder()) {
            throw new DriveException(DriveException.Reason.INVALID_FOLDER_URL, "The link is not a folder");
        }
        if (!folder.ownedBy(user.getEmail())) {
            throw new DriveException(DriveException.Reason.FOLDER_NOT_OWNED,
                "Only the owner of the folder can connect it");
        }

        var now = OffsetDateTime.now(clock);
        DriveSource source;
        if (existing.isPresent()) {
            source = existing.get();
            source.setRootName(folder.name());
            source.setAnonymous(req.anonymous());
            source.setConsent(DriveConsent.VERSION, now);
            source.setLastError(null);
            source.setConsecutiveFailures(0);
            source.setStatus(source.getApprovedAt() != null ? DriveSourceStatus.ACTIVE : DriveSourceStatus.PENDING_REVIEW);
        } else {
            source = new DriveSource(user.getId(), folderId, folder.name(), req.anonymous(), DriveConsent.VERSION, now);
            if (sources.existsByUserIdAndStatus(user.getId(), DriveSourceStatus.ACTIVE)) {
                source.setStatus(DriveSourceStatus.ACTIVE);
                source.setApprovedAt(now);
            }
            // Flushed so @CreationTimestamp is filled in for the response.
            source = sources.saveAndFlush(source);
        }
        unclaimed.deleteByDriveIdIn(List.of(folderId));
        source.setLastSyncRequestedAt(now);
        events.publishEvent(new DriveSyncRequested(source.getId()));
        return views.source(source);
    }

    private org.ceitba.api.external.drive.DriveItem fetchFolder(String folderId) {
        try {
            return drive.getFile(folderId);
        } catch (DriveApiException e) {
            if (e.isNotFoundOrForbidden()) {
                throw new DriveException(DriveException.Reason.FOLDER_NOT_SHARED,
                    "The folder is not shared with " + drive.botEmail());
            }
            throw new ExternalApiException("Google Drive", "files.get", e);
        }
    }

    @Transactional(readOnly = true)
    public List<SourceResponse> list(User user) {
        access.requireDriveAvailable();
        return views.sources(sources.findByUserIdAndStatusNotOrderByCreatedAtDesc(user.getId(),
            DriveSourceStatus.DISCONNECTED));
    }

    @Transactional(readOnly = true)
    public SourceTreeResponse tree(User user, UUID sourceId) {
        access.requireDriveAvailable();
        var source = owned(user, sourceId);
        return new SourceTreeResponse(views.source(source), views.tree(files.findBySourceId(sourceId),
            new java.util.HashSet<>(recalculator.planSubjectIds(user.getId()))));
    }

    // Re-runs subject suggestions (and publication) with the student's
    // current plan, without waiting for a sync. Returns the fresh tree.
    @Transactional
    public SourceTreeResponse recomputeSuggestions(User user, UUID sourceId) {
        access.requireDriveAvailable();
        var source = owned(user, sourceId);
        var all = files.findBySourceId(sourceId);
        var plan = recalculator.planSubjectIds(user.getId());
        recalculator.recompute(source, all, recalculator.matcher(plan));
        return new SourceTreeResponse(views.source(source), views.tree(all, new java.util.HashSet<>(plan)));
    }

    @Transactional
    public SourceResponse update(User user, UUID sourceId, boolean anonymous) {
        access.requireDriveAvailable();
        var source = owned(user, sourceId);
        source.setAnonymous(anonymous);
        return views.source(source);
    }

    // Unpublishes and deletes every copied file (rows now, objects after
    // commit); the source row stays as DISCONNECTED.
    @Transactional
    public void disconnect(User user, UUID sourceId) {
        access.requireDriveAvailable();
        var source = owned(user, sourceId);
        source.setStatus(DriveSourceStatus.DISCONNECTED);
        var all = files.findBySourceId(sourceId);
        var refs = all.stream().map(DriveBlobs.Ref::of).toList();
        var ids = all.stream().map(DriveFile::getId).toList();
        files.deleteAll(all);
        janitor.deleteAfterCommit(blobs.releasable(refs, ids));
    }

    @Transactional
    public void requestSync(User user, UUID sourceId) {
        access.requireDriveAvailable();
        var source = owned(user, sourceId);
        if (source.getStatus() == DriveSourceStatus.BLOCKED) {
            throw new InvalidStateException("This folder was blocked by staff");
        }
        var now = OffsetDateTime.now(clock);
        var last = source.getLastSyncRequestedAt();
        if (last != null && last.plus(MANUAL_SYNC_COOLDOWN).isAfter(now)) {
            long wait = Duration.between(now, last.plus(MANUAL_SYNC_COOLDOWN)).toSeconds() + 1;
            throw new DriveException(DriveException.Reason.SYNC_RATE_LIMITED,
                "A sync was requested less than 5 minutes ago", wait);
        }
        source.setLastSyncRequestedAt(now);
        events.publishEvent(new DriveSyncRequested(source.getId()));
    }

    // Applies each suggestion as the item's own subject. A matched folder
    // covers its children without their own (different) suggestion.
    @Transactional
    public AcceptSuggestionsResponse acceptSuggestions(User user, UUID sourceId) {
        access.requireDriveAvailable();
        var source = owned(user, sourceId);
        var all = files.findBySourceId(sourceId);
        Map<String, DriveFile> byDriveId = new HashMap<>();
        for (var f : all) byDriveId.put(f.getDriveId(), f);
        var ordered = new ArrayList<>(all);
        ordered.sort(Comparator.comparingInt(f -> DriveRecalculator.depth(f, byDriveId)));
        int applied = 0;
        for (var f : ordered) {
            // Suggestions exist only on items without a subject (own or
            // inherited at recompute time) and only where they differ from
            // what the item inherits, so each one is applied as is.
            if (f.getSuggestedSubjectId() == null || f.isRemovedFromDrive() || f.getSubjectId() != null) continue;
            f.setSubjectId(f.getSuggestedSubjectId());
            applied++;
        }
        recalculator.recompute(source, all);
        return new AcceptSuggestionsResponse(applied);
    }

    @Transactional
    public TreeItemResponse updateFile(User user, UUID fileId, UpdateFileRequest req) {
        access.requireDriveAvailable();
        var file = files.findById(fileId).orElseThrow(() -> DriveAccess.fileNotFound(fileId));
        var source = owned(user, file.getSourceId());
        if (req.subjectId() != null) {
            var subjectId = req.subjectId().trim();
            if (subjectId.isEmpty()) {
                file.setSubjectId(null);
            } else {
                if (!subjects.existsById(subjectId)) {
                    throw new ValidationException("subjectId", subjectId, "unknown subject");
                }
                file.setSubjectId(subjectId);
            }
        }
        if (req.hidden() != null) file.setHiddenByUser(req.hidden());
        var all = files.findBySourceId(source.getId());
        recalculator.recompute(source, all);
        Map<String, UUID> idByDriveId = new HashMap<>();
        for (var f : all) idByDriveId.put(f.getDriveId(), f.getId());
        var names = views.subjectNames(java.util.Arrays.asList(
            file.getSubjectId(), file.getEffectiveSubjectId(), file.getSuggestedSubjectId()));
        return views.treeItem(file, idByDriveId, names, new java.util.HashSet<>(recalculator.planSubjectIds(user.getId())));
    }

    private DriveSource owned(User user, UUID sourceId) {
        return sources.findByIdAndUserId(sourceId, user.getId())
            .filter(s -> s.getStatus() != DriveSourceStatus.DISCONNECTED)
            .orElseThrow(() -> DriveAccess.sourceNotFound(sourceId));
    }
}
