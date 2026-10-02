package org.ceitba.api.service.drive;

import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.domain.Subject;
import org.ceitba.api.domain.User;
import org.ceitba.api.domain.drive.DriveFile;
import org.ceitba.api.domain.drive.DriveFileReport;
import org.ceitba.api.domain.drive.DriveFileReportId;
import org.ceitba.api.domain.drive.DrivePublication;
import org.ceitba.api.domain.drive.DriveSource;
import org.ceitba.api.repository.SubjectRepository;
import org.ceitba.api.repository.drive.DriveFileReportRepository;
import org.ceitba.api.repository.drive.DriveFileRepository;
import org.ceitba.api.repository.drive.DriveSourceRepository;
import org.ceitba.api.service.media.ObjectStorage;
import org.ceitba.api.web.drive.dto.ApuntesSubjectResponse;
import org.ceitba.api.web.drive.dto.FileDetailResponse;
import org.ceitba.api.web.drive.dto.FileGroupResponse;
import org.ceitba.api.web.drive.dto.ReportFileRequest;
import org.ceitba.api.web.drive.dto.SubjectFilesResponse;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

// Apuntes for logged-in readers (/v1/wiki/...). Readers see PUBLISHED files
// only; the source's student and STAFF may open any of theirs/all (preview).
// Downloads are 5-minute signed URLs to the drive/ prefix, which is never
// anonymously readable.
@Service
public class DriveReaderService {

    static final Duration DOWNLOAD_TTL = Duration.ofMinutes(5);
    static final int MAX_LIMIT = 100;

    private final DriveFileRepository files;
    private final DriveSourceRepository sources;
    private final DriveFileReportRepository reports;
    private final SubjectRepository subjects;
    private final DriveAccess access;
    private final DriveViews views;
    private final DriveRecalculator recalculator;
    private final ObjectStorage storage;
    private final Clock clock;

    public DriveReaderService(DriveFileRepository files, DriveSourceRepository sources,
                              DriveFileReportRepository reports, SubjectRepository subjects, DriveAccess access,
                              DriveViews views, DriveRecalculator recalculator, ObjectStorage storage, Clock clock) {
        this.files = files;
        this.sources = sources;
        this.reports = reports;
        this.subjects = subjects;
        this.access = access;
        this.views = views;
        this.recalculator = recalculator;
        this.storage = storage;
        this.clock = clock;
    }

    // No q: subjects with published files, most recently updated first.
    // With q: every subject whose code or name matches (accent-insensitive),
    // with its published count (possibly 0), most files first.
    @Transactional(readOnly = true)
    public List<ApuntesSubjectResponse> subjects(String q, int limit) {
        int n = Math.max(1, Math.min(limit, MAX_LIMIT));
        if (q == null || q.isBlank()) {
            var rows = files.publishedSubjects(PageRequest.of(0, n));
            var names = views.subjectNames(rows.stream().map(r -> (String) r[0]).toList());
            return rows.stream()
                .map(r -> new ApuntesSubjectResponse((String) r[0], names.get((String) r[0]),
                    ((Number) r[1]).longValue(), (OffsetDateTime) r[2]))
                .toList();
        }
        var needle = SubjectMatcher.normalize(q);
        var matching = subjects.findAll().stream()
            .filter(s -> s.getId().toLowerCase().contains(q.trim().toLowerCase())
                || SubjectMatcher.normalize(s.getName()).contains(needle))
            .toList();
        if (matching.isEmpty()) return List.of();
        Map<String, Object[]> stats = new HashMap<>();
        for (var r : files.publishedSubjectsIn(matching.stream().map(Subject::getId).toList())) {
            stats.put((String) r[0], r);
        }
        return matching.stream()
            .map(s -> {
                var r = stats.get(s.getId());
                return new ApuntesSubjectResponse(s.getId(), s.getName(),
                    r == null ? 0 : ((Number) r[1]).longValue(), r == null ? null : (OffsetDateTime) r[2]);
            })
            .sorted(Comparator.comparingLong(ApuntesSubjectResponse::fileCount).reversed()
                .thenComparing(ApuntesSubjectResponse::subjectName, String.CASE_INSENSITIVE_ORDER))
            .limit(n)
            .toList();
    }

    @Transactional(readOnly = true)
    public SubjectFilesResponse subjectFiles(String subjectId) {
        var subject = subjects.findById(subjectId)
            .orElseThrow(() -> new ResourceNotFoundException("Subject", subjectId));
        var published = files.findByEffectiveSubjectIdAndPublicationOrderByNameAsc(subjectId, DrivePublication.PUBLISHED);
        var sourceIds = published.stream().map(DriveFile::getSourceId).distinct().toList();
        Map<UUID, DriveSource> sourceById = new HashMap<>();
        sources.findAllById(sourceIds).forEach(s -> sourceById.put(s.getId(), s));
        var owners = views.usersById(sourceById.values().stream().map(DriveSource::getUserId).toList());
        var folders = views.foldersBySource(sourceIds);

        Map<UUID, List<DriveFile>> bySource = new LinkedHashMap<>();
        for (var f : published) bySource.computeIfAbsent(f.getSourceId(), k -> new ArrayList<>()).add(f);
        var groups = new ArrayList<FileGroupResponse>();
        for (var e : bySource.entrySet()) {
            var source = sourceById.get(e.getKey());
            if (source == null) continue;
            var sourceFolders = folders.getOrDefault(e.getKey(), Map.of());
            var summaries = e.getValue().stream()
                .map(f -> DriveViews.summary(f, DriveViews.path(f, sourceFolders)))
                .sorted(Comparator.comparing((org.ceitba.api.web.drive.dto.FileSummaryResponse s) -> s.path(),
                        String.CASE_INSENSITIVE_ORDER)
                    .thenComparing(s -> s.name(), String.CASE_INSENSITIVE_ORDER))
                .toList();
            groups.add(new FileGroupResponse(source.getId(),
                DriveViews.author(source, owners.get(source.getUserId())), summaries));
        }
        return new SubjectFilesResponse(subject.getId(), subject.getName(), groups);
    }

    @Transactional(readOnly = true)
    public FileDetailResponse file(User user, UUID fileId) {
        var v = visible(user, fileId);
        var folders = views.foldersBySource(List.of(v.source().getId())).getOrDefault(v.source().getId(), Map.of());
        var owner = views.usersById(List.of(v.source().getUserId())).get(v.source().getUserId());
        var subjectName = v.file().getEffectiveSubjectId() == null ? null
            : views.subjectNames(List.of(v.file().getEffectiveSubjectId())).get(v.file().getEffectiveSubjectId());
        return DriveViews.detail(v.file(), DriveViews.path(v.file(), folders), subjectName,
            DriveViews.author(v.source(), owner), reports.existsByFileIdAndUserId(fileId, user.getId()));
    }

    // variant: "pdf", "original", or null (pdf when there is one).
    @Transactional(readOnly = true)
    public String downloadUrl(User user, UUID fileId, String variant) {
        var f = visible(user, fileId).file();
        String key;
        String filename;
        if ("original".equalsIgnoreCase(variant)) {
            key = f.getOriginalKey();
            filename = f.getName();
        } else if (variant == null || variant.isBlank() || "pdf".equalsIgnoreCase(variant)) {
            key = f.getPdfKey() != null ? f.getPdfKey() : (variant == null || variant.isBlank() ? f.getOriginalKey() : null);
            filename = key != null && key.equals(f.getPdfKey()) ? pdfName(f.getName()) : f.getName();
        } else {
            throw new org.ceitba.api.common.exception.ValidationException("variant", variant, "must be pdf or original");
        }
        if (key == null) throw new ResourceNotFoundException("DriveFile download", fileId + "/" + variant);
        return storage.presignGet(key, DOWNLOAD_TTL, filename);
    }

    @Transactional(readOnly = true)
    public String assetUrl(User user, UUID fileId, String name) {
        var f = visible(user, fileId).file();
        if (f.getAssetPrefix() == null || !f.getAssetNames().contains(name)) {
            throw new ResourceNotFoundException("DriveFile asset", fileId + "/" + name);
        }
        return storage.presignGet(f.getAssetPrefix() + name, DOWNLOAD_TTL);
    }

    // One report per reader and file (a new one replaces it); 3 hide a
    // PUBLISHED file. Only files readers can see can be reported.
    @Transactional
    public void report(User user, UUID fileId, ReportFileRequest req) {
        var f = files.findById(fileId).orElseThrow(() -> DriveAccess.fileNotFound(fileId));
        if (f.getPublication() != DrivePublication.PUBLISHED && f.getPublication() != DrivePublication.HIDDEN_REPORTED) {
            throw DriveAccess.fileNotFound(fileId);
        }
        var now = OffsetDateTime.now(clock);
        var comment = req.comment() == null || req.comment().isBlank() ? null : req.comment().trim();
        reports.findById(new DriveFileReportId(fileId, user.getId())).ifPresentOrElse(
            r -> r.update(req.reason(), comment, now),
            () -> reports.save(new DriveFileReport(fileId, user.getId(), req.reason(), comment, now)));
        reports.flush();
        f.setReportCount((int) reports.countByFileId(fileId));
        var source = sources.findById(f.getSourceId()).orElseThrow(() -> DriveAccess.sourceNotFound(f.getSourceId()));
        recalculator.recompute(source, files.findBySourceId(source.getId()));
    }

    private record Visible(DriveFile file, DriveSource source) {}

    private Visible visible(User user, UUID fileId) {
        var f = files.findById(fileId).orElseThrow(() -> DriveAccess.fileNotFound(fileId));
        var source = sources.findById(f.getSourceId()).orElseThrow(() -> DriveAccess.fileNotFound(fileId));
        if (!access.canView(user.getId(), f, source)) throw DriveAccess.fileNotFound(fileId);
        return new Visible(f, source);
    }

    private static String pdfName(String name) {
        return name.toLowerCase().endsWith(".pdf") ? name : name + ".pdf";
    }
}
