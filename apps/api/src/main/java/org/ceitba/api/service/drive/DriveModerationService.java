package org.ceitba.api.service.drive;

import org.ceitba.api.common.exception.InvalidStateException;
import org.ceitba.api.common.exception.ValidationException;
import org.ceitba.api.domain.drive.DriveFile;
import org.ceitba.api.domain.drive.DriveFileReport;
import org.ceitba.api.domain.drive.DrivePublication;
import org.ceitba.api.domain.drive.DriveSource;
import org.ceitba.api.domain.drive.DriveSourceStatus;
import org.ceitba.api.domain.drive.DriveStaffDecision;
import org.ceitba.api.repository.drive.DriveFileReportRepository;
import org.ceitba.api.repository.drive.DriveFileRepository;
import org.ceitba.api.repository.drive.DriveSourceRepository;
import org.ceitba.api.repository.drive.DriveUnclaimedShareRepository;
import org.ceitba.api.service.kb.KbModerationService;
import org.ceitba.api.web.drive.dto.PageResponse;
import org.ceitba.api.web.drive.dto.StaffFileResponse;
import org.ceitba.api.web.drive.dto.StaffReportResponse;
import org.ceitba.api.web.drive.dto.StaffSourceResponse;
import org.ceitba.api.web.drive.dto.UnclaimedShareResponse;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

// STAFF moderation of Drive sync (/v1/staff/drive) plus report withdrawal
// for account deletion. Staff decisions on files (PUBLISH/REMOVE) stick
// across syncs; restore clears the decision and dismisses the reports.
@Service
public class DriveModerationService {

    static final int MAX_LIMIT = 100;

    private final DriveSourceRepository sources;
    private final DriveFileRepository files;
    private final DriveFileReportRepository reports;
    private final DriveUnclaimedShareRepository unclaimed;
    private final DriveRecalculator recalculator;
    private final DriveViews views;
    private final DriveStorageJanitor janitor;
    private final DriveBlobs blobs;
    private final KbModerationService kb;
    private final Clock clock;

    public DriveModerationService(DriveSourceRepository sources, DriveFileRepository files,
                                  DriveFileReportRepository reports, DriveUnclaimedShareRepository unclaimed,
                                  DriveRecalculator recalculator, DriveViews views, DriveStorageJanitor janitor,
                                  DriveBlobs blobs, KbModerationService kb, Clock clock) {
        this.sources = sources;
        this.files = files;
        this.reports = reports;
        this.unclaimed = unclaimed;
        this.recalculator = recalculator;
        this.views = views;
        this.janitor = janitor;
        this.blobs = blobs;
        this.kb = kb;
        this.clock = clock;
    }

    // status null: every source except DISCONNECTED, newest first.
    @Transactional(readOnly = true)
    public PageResponse<StaffSourceResponse> sources(String status, int page, int limit) {
        var pageable = PageRequest.of(Math.max(page, 0), Math.max(1, Math.min(limit, MAX_LIMIT)));
        var result = status == null || status.isBlank()
            ? sources.findByStatusNotOrderByCreatedAtDesc(DriveSourceStatus.DISCONNECTED, pageable)
            : sources.findByStatusOrderByCreatedAtDesc(parse(DriveSourceStatus.class, "status", status), pageable);
        return new PageResponse<>(views.staffSources(result.getContent()), result.getTotalElements());
    }

    @Transactional
    public StaffSourceResponse approve(UUID staffId, UUID sourceId, String comment) {
        var source = source(sourceId);
        if (source.getStatus() == DriveSourceStatus.DISCONNECTED || source.getStatus() == DriveSourceStatus.REVOKED) {
            throw new InvalidStateException("A " + source.getStatus() + " source cannot be approved");
        }
        var now = OffsetDateTime.now(clock);
        source.setStatus(DriveSourceStatus.ACTIVE);
        if (source.getApprovedAt() == null) source.setApprovedAt(now);
        source.setReview(staffId, now, blankToNull(comment));
        recalculator.recompute(source, files.findBySourceId(sourceId));
        return views.staffSources(List.of(source)).get(0);
    }

    @Transactional
    public StaffSourceResponse block(UUID staffId, UUID sourceId, String comment) {
        var source = source(sourceId);
        if (source.getStatus() == DriveSourceStatus.DISCONNECTED) {
            throw new InvalidStateException("A DISCONNECTED source cannot be blocked");
        }
        var now = OffsetDateTime.now(clock);
        source.setStatus(DriveSourceStatus.BLOCKED);
        source.setReview(staffId, now, blankToNull(comment));
        var all = files.findBySourceId(sourceId);
        recalculator.recompute(source, all);
        // Takedown: wiki pages built on this folder's files go hidden.
        kb.hidePagesCiting(all.stream().map(DriveFile::getId).toList());
        return views.staffSources(List.of(source)).get(0);
    }

    // publication null: NEEDS_REVIEW. Files of PENDING_REVIEW sources are
    // left out (staff handle those by approving/blocking the source).
    @Transactional(readOnly = true)
    public PageResponse<StaffFileResponse> files(String publication, int page, int limit) {
        var pub = publication == null || publication.isBlank()
            ? DrivePublication.NEEDS_REVIEW : parse(DrivePublication.class, "publication", publication);
        var result = files.findStaffQueue(pub, DriveSourceStatus.PENDING_REVIEW,
            PageRequest.of(Math.max(page, 0), Math.max(1, Math.min(limit, MAX_LIMIT))));
        return new PageResponse<>(staffFiles(result.getContent()), result.getTotalElements());
    }

    @Transactional
    public StaffFileResponse publish(UUID fileId) {
        return decide(fileId, DriveStaffDecision.PUBLISH, false);
    }

    @Transactional
    public StaffFileResponse remove(UUID fileId) {
        return decide(fileId, DriveStaffDecision.REMOVE, false);
    }

    // Back to the rule: clears the staff decision and dismisses the reports.
    @Transactional
    public StaffFileResponse restore(UUID fileId) {
        return decide(fileId, null, true);
    }

    private StaffFileResponse decide(UUID fileId, DriveStaffDecision decision, boolean dismissReports) {
        var file = files.findById(fileId).orElseThrow(() -> DriveAccess.fileNotFound(fileId));
        if (file.isFolder()) throw DriveAccess.fileNotFound(fileId);
        file.setStaffDecision(decision);
        if (dismissReports) {
            reports.deleteByFileId(fileId);
            file.setReportCount(0);
        }
        var source = source(file.getSourceId());
        recalculator.recompute(source, files.findBySourceId(source.getId()));
        // Takedown: wiki pages citing a file staff removed go hidden.
        if (decision == DriveStaffDecision.REMOVE) kb.hidePagesCiting(List.of(fileId));
        return staffFiles(List.of(file)).get(0);
    }

    @Transactional(readOnly = true)
    public List<UnclaimedShareResponse> unclaimed() {
        return unclaimed.findAllByOrderByLastSeenAtDesc().stream()
            .map(u -> new UnclaimedShareResponse(u.getName(), u.getOwnerEmail(), u.getFirstSeenAt(), u.getLastSeenAt()))
            .toList();
    }

    // Account deletion: the user's reports go and the files they touched are
    // recounted (a file hidden by 3 reports may become PUBLISHED again).
    @Transactional
    public void withdrawReportsOf(UUID userId) {
        var fileIds = reports.findFileIdsByUserId(userId);
        if (fileIds.isEmpty()) return;
        reports.deleteByUserId(userId);
        var touchedSources = new HashSet<UUID>();
        for (var f : files.findAllById(fileIds)) {
            f.setReportCount((int) reports.countByFileId(f.getId()));
            touchedSources.add(f.getSourceId());
        }
        for (var s : sources.findAllById(touchedSources)) {
            recalculator.recompute(s, files.findBySourceId(s.getId()));
        }
    }

    // Account deletion, before AccountDeletionRepository.deleteDriveSources:
    // withdraws the user's reports and schedules the stored copies of their
    // sources for deletion once the deletion commits (best effort).
    @Transactional
    public void prepareAccountDeletion(UUID userId) {
        withdrawReportsOf(userId);
        var ids = sources.findByUserId(userId).stream().map(DriveSource::getId).toList();
        if (ids.isEmpty()) return;
        var rows = files.findBySourceIdIn(ids);
        janitor.deleteAfterCommit(blobs.releasable(rows.stream().map(DriveBlobs.Ref::of).toList(),
            rows.stream().map(DriveFile::getId).toList()));
    }

    private List<StaffFileResponse> staffFiles(List<DriveFile> page) {
        if (page.isEmpty()) return List.of();
        Map<UUID, DriveSource> sourceById = new HashMap<>();
        sources.findAllById(page.stream().map(DriveFile::getSourceId).distinct().toList())
            .forEach(s -> sourceById.put(s.getId(), s));
        var sharers = views.usersById(sourceById.values().stream().map(DriveSource::getUserId).toList());
        var names = views.subjectNames(page.stream().map(DriveFile::getEffectiveSubjectId).toList());
        Map<UUID, List<StaffReportResponse>> reportsByFile = new HashMap<>();
        for (DriveFileReport r : reports.findByFileIdInOrderByCreatedAtDesc(page.stream().map(DriveFile::getId).toList())) {
            reportsByFile.computeIfAbsent(r.getFileId(), k -> new ArrayList<>())
                .add(new StaffReportResponse(r.getReason().name(), r.getComment(), r.getCreatedAt()));
        }
        return page.stream().map(f -> {
            var source = sourceById.get(f.getSourceId());
            var sharer = source == null ? null : sharers.get(source.getUserId());
            return new StaffFileResponse(f.getId(), f.getName(), f.getKind().name(), f.getSourceId(),
                source == null ? null : source.getRootName(), f.getOwnerEmail(),
                sharer == null ? null : sharer.getName(), sharer == null ? null : sharer.getEmail(),
                f.getEffectiveSubjectId(), names.get(f.getEffectiveSubjectId()), f.getPublication().name(),
                f.getReportCount(), reportsByFile.getOrDefault(f.getId(), List.of()), f.getDriveModifiedAt());
        }).toList();
    }

    private DriveSource source(UUID id) {
        return sources.findById(id).orElseThrow(() -> DriveAccess.sourceNotFound(id));
    }

    private static <E extends Enum<E>> E parse(Class<E> type, String field, String value) {
        try {
            return Enum.valueOf(type, value.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new ValidationException(field, value, "unknown value");
        }
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
