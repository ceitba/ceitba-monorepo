package org.ceitba.api.service.kb;

import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.domain.User;
import org.ceitba.api.domain.kb.KbPage;
import org.ceitba.api.domain.kb.KbPageReport;
import org.ceitba.api.domain.kb.KbPageReportId;
import org.ceitba.api.domain.kb.KbPageStatus;
import org.ceitba.api.domain.kb.KbPageType;
import org.ceitba.api.repository.SubjectRepository;
import org.ceitba.api.repository.kb.KbLinkRepository;
import org.ceitba.api.repository.kb.KbPageReportRepository;
import org.ceitba.api.repository.kb.KbPageRepository;
import org.ceitba.api.repository.kb.KbRelationRepository;
import org.ceitba.api.service.drive.DriveAccess;
import org.ceitba.api.web.kb.dto.KbGraphResponse;
import org.ceitba.api.web.kb.dto.KbPageResponse;
import org.ceitba.api.web.kb.dto.KbRelatedResponse;
import org.ceitba.api.web.kb.dto.KbReportRequest;
import org.ceitba.api.web.kb.dto.KbSubjectResponse;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

// Subject wikis for logged-in readers (docs/SUBJECT-WIKI.md). Readers see
// PUBLISHED pages only; STAFF also see HIDDEN ones.
@Service
public class KbReaderService {

    public static final int REPORT_THRESHOLD = 3;

    private static final Set<KbPageStatus> STAFF_VISIBLE = Set.of(KbPageStatus.PUBLISHED, KbPageStatus.HIDDEN);
    private static final Set<KbPageStatus> READER_VISIBLE = Set.of(KbPageStatus.PUBLISHED);

    private final KbPageRepository pages;
    private final KbLinkRepository links;
    private final KbPageReportRepository reports;
    private final KbRelationRepository relations;
    private final SubjectRepository subjects;
    private final KbViews views;
    private final DriveAccess access;
    private final Clock clock;

    public KbReaderService(KbPageRepository pages, KbLinkRepository links, KbPageReportRepository reports,
                           KbRelationRepository relations, SubjectRepository subjects, KbViews views,
                           DriveAccess access, Clock clock) {
        this.pages = pages;
        this.links = links;
        this.reports = reports;
        this.relations = relations;
        this.subjects = subjects;
        this.views = views;
        this.access = access;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public KbSubjectResponse subject(User user, String subjectId) {
        var subject = subjects.findById(subjectId).orElseThrow(() -> new ResourceNotFoundException("Subject", subjectId));
        boolean staff = access.isStaff(user.getId());
        var visible = pages.findBySubjectIdAndStatusIn(subjectId, staff ? STAFF_VISIBLE : READER_VISIBLE).stream()
            .sorted(KbViews.ORDER)
            .toList();
        var index = visible.stream().filter(p -> p.getType() == KbPageType.INDEX).findFirst()
            .map(p -> views.page(p, user.getId(), staff))
            .orElse(null);
        return new KbSubjectResponse(subject.getId(), subject.getName(), index,
            visible.stream().map(KbViews::summary).toList(), related(subjectId, visible));
    }

    // Prerequisites, then dependents (both by number of plans), then subjects
    // this wiki links to or that link to it. One entry per subject.
    private List<KbRelatedResponse> related(String subjectId, List<KbPage> visible) {
        Map<String, String> reasonBySubject = new LinkedHashMap<>();
        var rows = relations.findBySubject(subjectId);
        for (var reason : List.of("PREREQUISITE", "DEPENDENT")) {
            for (var r : rows) if (r.reason().equals(reason)) reasonBySubject.putIfAbsent(r.relatedId(), reason);
        }
        var linked = new LinkedHashSet<String>();
        var ownIds = visible.stream().map(KbPage::getId).toList();
        if (!ownIds.isEmpty()) {
            for (var l : links.findByFromPageIdIn(ownIds)) linked.add(l.getToSubjectId());
        }
        var incoming = links.findByToSubjectId(subjectId).stream().map(l -> l.getFromPageId()).distinct().toList();
        for (var p : pages.findAllById(incoming)) {
            if (p.getStatus() == KbPageStatus.PUBLISHED) linked.add(p.getSubjectId());
        }
        for (var s : linked) reasonBySubject.putIfAbsent(s, "LINKED");
        reasonBySubject.remove(subjectId);
        if (reasonBySubject.isEmpty()) return List.of();

        Map<String, String> names = new HashMap<>();
        subjects.findAllById(reasonBySubject.keySet()).forEach(s -> names.put(s.getId(), s.getName()));
        var withWiki = new java.util.HashSet<>(pages.findSubjectIdsWithPages(reasonBySubject.keySet(), READER_VISIBLE));
        var out = new ArrayList<KbRelatedResponse>();
        reasonBySubject.forEach((id, reason) -> {
            if (names.containsKey(id)) out.add(new KbRelatedResponse(id, names.get(id), reason, withWiki.contains(id)));
        });
        return out;
    }

    @Transactional(readOnly = true)
    public KbPageResponse page(User user, String subjectId, String slug) {
        boolean staff = access.isStaff(user.getId());
        var page = pages.findBySubjectIdAndSlug(subjectId, slug)
            .filter(p -> KbViews.visible(p, staff))
            .orElseThrow(() -> new ResourceNotFoundException("KbPage", subjectId + "/" + slug));
        return views.page(page, user.getId(), staff);
    }

    @Transactional(readOnly = true)
    public KbGraphResponse graph(User user, String subjectId) {
        if (!subjects.existsById(subjectId)) throw new ResourceNotFoundException("Subject", subjectId);
        boolean staff = access.isStaff(user.getId());
        Map<UUID, KbPage> nodes = new LinkedHashMap<>();
        var own = pages.findBySubjectIdAndStatusIn(subjectId, staff ? STAFF_VISIBLE : READER_VISIBLE).stream()
            .sorted(KbViews.ORDER).toList();
        own.forEach(p -> nodes.put(p.getId(), p));
        if (own.isEmpty()) return new KbGraphResponse(List.of(), List.of());
        var ownIds = nodes.keySet();

        var out = links.findByFromPageIdIn(List.copyOf(ownIds));
        var in = links.findByToPageIdIn(List.copyOf(ownIds));
        var otherIds = new LinkedHashSet<UUID>();
        out.forEach(l -> { if (l.getToPageId() != null && !ownIds.contains(l.getToPageId())) otherIds.add(l.getToPageId()); });
        in.forEach(l -> { if (!ownIds.contains(l.getFromPageId())) otherIds.add(l.getFromPageId()); });
        Map<UUID, KbPage> external = new LinkedHashMap<>();
        for (var p : pages.findAllById(otherIds)) if (KbViews.visible(p, staff)) external.put(p.getId(), p);

        var edges = new LinkedHashSet<KbGraphResponse.Edge>();
        for (var l : out) {
            if (l.getToPageId() != null && (nodes.containsKey(l.getToPageId()) || external.containsKey(l.getToPageId()))
                    && !l.getToPageId().equals(l.getFromPageId())) {
                edges.add(new KbGraphResponse.Edge(l.getFromPageId(), l.getToPageId()));
            }
        }
        for (var l : in) {
            if (external.containsKey(l.getFromPageId())) edges.add(new KbGraphResponse.Edge(l.getFromPageId(), l.getToPageId()));
        }
        var nodeDtos = new ArrayList<KbGraphResponse.Node>();
        nodes.values().forEach(p -> nodeDtos.add(node(p, false)));
        external.values().stream().sorted(KbViews.ORDER).forEach(p -> nodeDtos.add(node(p, true)));
        return new KbGraphResponse(nodeDtos, List.copyOf(edges));
    }

    private static KbGraphResponse.Node node(KbPage p, boolean external) {
        return new KbGraphResponse.Node(p.getId(), p.getSubjectId(), p.getSlug(), p.getTitle(), p.getType().wire(), external);
    }

    // One report per reader and page (a new one replaces it); at 3 a
    // PUBLISHED page is hidden. Only PUBLISHED pages can be reported (or
    // re-reported by someone who already did).
    @Transactional
    public void report(User user, UUID pageId, KbReportRequest req) {
        var page = pages.findById(pageId).orElseThrow(() -> new ResourceNotFoundException("KbPage", pageId.toString()));
        var existing = reports.findById(new KbPageReportId(pageId, user.getId()));
        if (page.getStatus() != KbPageStatus.PUBLISHED && existing.isEmpty()) {
            throw new ResourceNotFoundException("KbPage", pageId.toString());
        }
        var now = OffsetDateTime.now(clock);
        var comment = req.comment() == null || req.comment().isBlank() ? null : req.comment().trim();
        existing.ifPresentOrElse(
            r -> r.update(req.reason(), comment, now),
            () -> reports.save(new KbPageReport(pageId, user.getId(), req.reason(), comment, now)));
        reports.flush();
        page.setReportCount((int) reports.countByPageId(pageId));
        if (page.getStatus() == KbPageStatus.PUBLISHED && page.getReportCount() >= REPORT_THRESHOLD) {
            page.setStatus(KbPageStatus.HIDDEN);
        }
    }
}
