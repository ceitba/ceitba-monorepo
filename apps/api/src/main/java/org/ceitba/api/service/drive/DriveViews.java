package org.ceitba.api.service.drive;

import org.ceitba.api.domain.Subject;
import org.ceitba.api.domain.User;
import org.ceitba.api.domain.drive.DriveFile;
import org.ceitba.api.domain.drive.DriveFileKind;
import org.ceitba.api.domain.drive.DriveSource;
import org.ceitba.api.repository.SubjectRepository;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.repository.drive.DriveFileRepository;
import org.ceitba.api.web.drive.dto.AuthorResponse;
import org.ceitba.api.web.drive.dto.FileDetailResponse;
import org.ceitba.api.web.drive.dto.FileSummaryResponse;
import org.ceitba.api.web.drive.dto.SourceResponse;
import org.ceitba.api.web.drive.dto.StaffSourceResponse;
import org.ceitba.api.web.drive.dto.TreeItemResponse;
import org.springframework.stereotype.Component;

import java.util.ArrayDeque;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

// Entity -> DTO mapping shared by the drive services (called inside their
// transactions; entities never leave service/).
@Component
public class DriveViews {

    private final DriveFileRepository files;
    private final SubjectRepository subjects;
    private final UserRepository users;

    public DriveViews(DriveFileRepository files, SubjectRepository subjects, UserRepository users) {
        this.files = files;
        this.subjects = subjects;
        this.users = users;
    }

    private record Counts(long files, long published, long needsReview) {}

    private Map<UUID, Counts> counts(Collection<UUID> sourceIds) {
        Map<UUID, Counts> out = new HashMap<>();
        if (sourceIds.isEmpty()) return out;
        for (Object[] row : files.countsBySource(sourceIds)) {
            out.put((UUID) row[0], new Counts(num(row[1]), num(row[2]), num(row[3])));
        }
        return out;
    }

    private static long num(Object o) {
        return o == null ? 0 : ((Number) o).longValue();
    }

    public List<SourceResponse> sources(List<DriveSource> sources) {
        var counts = counts(sources.stream().map(DriveSource::getId).toList());
        return sources.stream().map(s -> source(s, counts.get(s.getId()))).toList();
    }

    public SourceResponse source(DriveSource s) {
        return source(s, counts(List.of(s.getId())).get(s.getId()));
    }

    private static SourceResponse source(DriveSource s, Counts c) {
        var k = c == null ? new Counts(0, 0, 0) : c;
        return new SourceResponse(s.getId(), s.getRootName(), s.getStatus().name(), s.isAnonymous(),
            s.getLastSyncedAt(), s.getLastError(), k.files(), k.published(), k.needsReview(), s.getCreatedAt());
    }

    public List<StaffSourceResponse> staffSources(List<DriveSource> sources) {
        var counts = counts(sources.stream().map(DriveSource::getId).toList());
        var owners = usersById(sources.stream().map(DriveSource::getUserId).toList());
        return sources.stream().map(s -> {
            var src = source(s, counts.get(s.getId()));
            var owner = owners.get(s.getUserId());
            return new StaffSourceResponse(src.id(), src.rootName(), src.status(), src.anonymous(),
                src.lastSyncedAt(), src.lastError(), src.fileCount(), src.publishedCount(),
                src.needsReviewCount(), src.createdAt(),
                owner == null ? null : owner.getName(), owner == null ? null : owner.getEmail());
        }).toList();
    }

    public Map<UUID, User> usersById(Collection<UUID> ids) {
        return users.findAllById(new HashSet<>(ids)).stream().collect(Collectors.toMap(User::getId, Function.identity()));
    }

    public Map<String, String> subjectNames(Collection<String> ids) {
        var wanted = ids.stream().filter(Objects::nonNull).collect(Collectors.toSet());
        if (wanted.isEmpty()) return Map.of();
        return subjects.findAllById(wanted).stream().collect(Collectors.toMap(Subject::getId, Subject::getName));
    }

    public List<TreeItemResponse> tree(List<DriveFile> items, java.util.Set<String> planSubjects) {
        Map<String, UUID> idByDriveId = new HashMap<>();
        for (var f : items) idByDriveId.put(f.getDriveId(), f.getId());
        var names = subjectNames(items.stream()
            .flatMap(f -> java.util.stream.Stream.of(f.getSubjectId(), f.getEffectiveSubjectId(), f.getSuggestedSubjectId()))
            .toList());
        return items.stream()
            .sorted((a, b) -> {
                if (a.isFolder() != b.isFolder()) return a.isFolder() ? -1 : 1;
                return a.getName().compareToIgnoreCase(b.getName());
            })
            .map(f -> treeItem(f, idByDriveId, names, planSubjects))
            .toList();
    }

    public TreeItemResponse treeItem(DriveFile f, Map<String, UUID> idByDriveId, Map<String, String> names,
                                     java.util.Set<String> planSubjects) {
        return new TreeItemResponse(
            f.getId(),
            f.getParentDriveId() == null ? null : idByDriveId.get(f.getParentDriveId()),
            f.getName(), f.getKind().name(),
            f.getSubjectId(), names.get(f.getSubjectId()),
            f.getEffectiveSubjectId(), names.get(f.getEffectiveSubjectId()),
            f.getSuggestedSubjectId(), names.get(f.getSuggestedSubjectId()),
            f.getSuggestedSubjectId() != null && planSubjects.contains(f.getSuggestedSubjectId()),
            f.getEffectiveSubjectId() != null && planSubjects.contains(f.getEffectiveSubjectId()),
            f.isHidden(), f.getPublication().name(), f.isOwnedBySharer(),
            f.getSizeBytes(), f.getDriveModifiedAt(), f.getSyncError(), f.isExportBlocked(),
            DriveMedia.driveUrl(f.getDriveId(), f.getMimeType()));
    }

    public static AuthorResponse author(DriveSource source, User owner) {
        if (source.isAnonymous()) return new AuthorResponse(null, true);
        return new AuthorResponse(owner == null ? null : owner.getName(), false);
    }

    // Folder path of `file` inside its source, from the source's folders.
    public static String path(DriveFile file, Map<String, DriveFile> foldersByDriveId) {
        var parts = new ArrayDeque<String>();
        var seen = new HashSet<String>();
        var parentId = file.getParentDriveId();
        while (parentId != null && seen.add(parentId)) {
            var folder = foldersByDriveId.get(parentId);
            if (folder == null) break;
            parts.addFirst(folder.getName());
            parentId = folder.getParentDriveId();
        }
        return String.join("/", parts);
    }

    public Map<UUID, Map<String, DriveFile>> foldersBySource(Collection<UUID> sourceIds) {
        Map<UUID, Map<String, DriveFile>> out = new HashMap<>();
        if (sourceIds.isEmpty()) return out;
        for (var f : files.findBySourceIdInAndKind(new HashSet<>(sourceIds), DriveFileKind.FOLDER)) {
            out.computeIfAbsent(f.getSourceId(), k -> new HashMap<>()).put(f.getDriveId(), f);
        }
        return out;
    }

    public static FileSummaryResponse summary(DriveFile f, String path) {
        return new FileSummaryResponse(f.getId(), f.getName(), f.getKind().name(), path, f.getSizeBytes(),
            f.getDriveModifiedAt(), f.getPublishedAt(), f.getHtmlContent() != null, f.getPdfKey() != null,
            f.getOriginalKey() != null, pdfMimeType(f), originalMimeType(f), f.isExportBlocked(),
            DriveMedia.driveUrl(f.getDriveId(), f.getMimeType()));
    }

    static String pdfMimeType(DriveFile f) {
        return f.getPdfKey() == null ? null : DriveMedia.PDF;
    }

    static String originalMimeType(DriveFile f) {
        return f.getOriginalKey() == null ? null : DriveMedia.servedType(f.getOriginalContentType(), f.getName());
    }

    public static FileDetailResponse detail(DriveFile f, String path, String subjectName, AuthorResponse author,
                                            boolean reportedByMe) {
        return new FileDetailResponse(f.getId(), f.getName(), f.getKind().name(), path, f.getSizeBytes(),
            f.getDriveModifiedAt(), f.getPublishedAt(), f.getHtmlContent() != null, f.getPdfKey() != null,
            f.getOriginalKey() != null, pdfMimeType(f), originalMimeType(f), f.isExportBlocked(),
            DriveMedia.driveUrl(f.getDriveId(), f.getMimeType()), f.getEffectiveSubjectId(), subjectName, author,
            f.getHtmlContent(), reportedByMe);
    }
}
