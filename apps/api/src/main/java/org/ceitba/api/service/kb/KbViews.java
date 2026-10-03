package org.ceitba.api.service.kb;

import org.ceitba.api.domain.drive.DriveFile;
import org.ceitba.api.domain.drive.DrivePublication;
import org.ceitba.api.domain.drive.DriveSource;
import org.ceitba.api.domain.kb.KbPage;
import org.ceitba.api.domain.kb.KbPageStatus;
import org.ceitba.api.repository.drive.DriveFileRepository;
import org.ceitba.api.repository.drive.DriveSourceRepository;
import org.ceitba.api.repository.kb.KbLinkRepository;
import org.ceitba.api.repository.kb.KbPageReportRepository;
import org.ceitba.api.repository.kb.KbPageRepository;
import org.ceitba.api.service.drive.DriveViews;
import org.ceitba.api.web.kb.dto.KbBacklinkResponse;
import org.ceitba.api.web.kb.dto.KbLinkResponse;
import org.ceitba.api.web.kb.dto.KbPageResponse;
import org.ceitba.api.web.kb.dto.KbPageSummaryResponse;
import org.ceitba.api.web.kb.dto.KbSourceResponse;
import org.ceitba.api.web.kb.dto.KbStaffPageResponse;
import org.springframework.stereotype.Component;

import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

// Entity -> DTO mapping for the subject wikis (inside the callers' transactions).
@Component
public class KbViews {

    private final KbPageRepository pages;
    private final KbLinkRepository links;
    private final KbPageReportRepository reports;
    private final DriveFileRepository files;
    private final DriveSourceRepository sources;
    private final DriveViews driveViews;

    public KbViews(KbPageRepository pages, KbLinkRepository links, KbPageReportRepository reports,
                   DriveFileRepository files, DriveSourceRepository sources, DriveViews driveViews) {
        this.pages = pages;
        this.links = links;
        this.reports = reports;
        this.files = files;
        this.sources = sources;
        this.driveViews = driveViews;
    }

    // Readers see PUBLISHED pages; staff also HIDDEN ones.
    public static boolean visible(KbPage p, boolean staff) {
        return p != null && (p.getStatus() == KbPageStatus.PUBLISHED || (staff && p.getStatus() == KbPageStatus.HIDDEN));
    }

    // index first, then topics, then concepts; by title.
    public static final Comparator<KbPage> ORDER = Comparator.comparing(KbPage::getType)
        .thenComparing(KbPage::getTitle, String.CASE_INSENSITIVE_ORDER);

    public static KbPageSummaryResponse summary(KbPage p) {
        return new KbPageSummaryResponse(p.getId(), p.getSlug(), p.getTitle(), p.getType().wire(), p.getSummary(),
            p.getAliases());
    }

    public static KbStaffPageResponse staff(KbPage p) {
        return new KbStaffPageResponse(p.getId(), p.getSlug(), p.getTitle(), p.getType().wire(), p.getSummary(),
            p.getAliases(), p.getSubjectId(), p.getStatus().name(), p.getReportCount());
    }

    public KbPageResponse page(KbPage p, UUID viewerId, boolean staff) {
        var subjectNames = new HashSet<String>();
        subjectNames.add(p.getSubjectId());

        // Links of this page.
        var out = links.findByFromPageId(p.getId());
        Map<UUID, KbPage> targets = new HashMap<>();
        pages.findAllById(out.stream().map(l -> l.getToPageId()).filter(Objects::nonNull).toList())
            .forEach(t -> targets.put(t.getId(), t));
        var linkDtos = out.stream()
            .sorted(Comparator.comparing(l -> l.getRaw()))
            .map(l -> {
                var t = l.getToPageId() == null ? null : targets.get(l.getToPageId());
                boolean resolved = visible(t, staff);
                var anchor = KbWikilinks.target(l.getRaw(), p.getSubjectId(), p.getSlug()).anchor();
                return new KbLinkResponse(l.getRaw(), l.getToSubjectId(), l.getToSlug(), anchor, resolved,
                    resolved ? t.getTitle() : null);
            })
            .toList();

        // Pages linking here.
        var in = links.findByToPageId(p.getId());
        var fromPages = pages.findAllById(in.stream().map(l -> l.getFromPageId()).distinct().toList()).stream()
            .filter(f -> visible(f, staff) && !f.getId().equals(p.getId()))
            .sorted(ORDER)
            .toList();
        fromPages.forEach(f -> subjectNames.add(f.getSubjectId()));
        var names = driveViews.subjectNames(subjectNames);
        var backlinks = fromPages.stream()
            .map(f -> new KbBacklinkResponse(f.getSubjectId(), names.get(f.getSubjectId()), f.getSlug(), f.getTitle()))
            .toList();

        return new KbPageResponse(p.getId(), p.getSlug(), p.getTitle(), p.getType().wire(), p.getSummary(),
            p.getAliases(), p.getSubjectId(), names.get(p.getSubjectId()), p.getMarkdown(),
            sources(p.getSources(), staff), linkDtos, backlinks, p.getGenerator(), p.getGeneratedAt(),
            p.getRevision(), viewerId != null && reports.existsByPageIdAndUserId(p.getId(), viewerId),
            p.getStatus().name());
    }

    // The cited files, in frontmatter order; readers only get PUBLISHED ones.
    private List<KbSourceResponse> sources(List<UUID> ids, boolean staff) {
        if (ids.isEmpty()) return List.of();
        Map<UUID, DriveFile> byId = new HashMap<>();
        files.findAllById(ids).forEach(f -> byId.put(f.getId(), f));
        Map<UUID, DriveSource> sourceById = new HashMap<>();
        sources.findAllById(byId.values().stream().map(DriveFile::getSourceId).distinct().toList())
            .forEach(s -> sourceById.put(s.getId(), s));
        var owners = driveViews.usersById(sourceById.values().stream().map(DriveSource::getUserId).toList());
        return ids.stream()
            .map(byId::get)
            .filter(f -> f != null && (staff || f.getPublication() == DrivePublication.PUBLISHED))
            .map(f -> {
                var src = sourceById.get(f.getSourceId());
                var author = src == null ? null : DriveViews.author(src, owners.get(src.getUserId()));
                return new KbSourceResponse(f.getId(), f.getName(), f.getKind().name(), author);
            })
            .toList();
    }
}
