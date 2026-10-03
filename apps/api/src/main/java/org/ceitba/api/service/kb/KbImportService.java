package org.ceitba.api.service.kb;

import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.domain.drive.DriveFile;
import org.ceitba.api.domain.drive.DrivePublication;
import org.ceitba.api.domain.kb.KbLink;
import org.ceitba.api.domain.kb.KbPage;
import org.ceitba.api.domain.kb.KbPageRevision;
import org.ceitba.api.domain.kb.KbPageStatus;
import org.ceitba.api.repository.SubjectRepository;
import org.ceitba.api.repository.drive.DriveFileRepository;
import org.ceitba.api.repository.kb.KbLinkRepository;
import org.ceitba.api.repository.kb.KbPageRepository;
import org.ceitba.api.repository.kb.KbPageRevisionRepository;
import org.ceitba.api.web.kb.dto.KbImportRequest;
import org.ceitba.api.web.kb.dto.KbImportResponse;
import org.ceitba.api.web.kb.dto.KbRejectedPage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;

// POST /v1/staff/kb/subjects/{subjectId}/import (docs/SUBJECT-WIKI.md). One
// transaction:
//   - each page is parsed and validated; a rejected page keeps its previous
//     revision;
//   - an accepted page is created (revision 1) or, when its content
//     changed, its previous version goes to kb_page_revision and `revision`
//     goes up; a REMOVED page comes back as PUBLISHED, a HIDDEN one stays
//     hidden (staff restore it);
//   - its wikilinks replace its kb_link rows;
//   - replace=true: pages of the subject whose slug is not in the payload
//     (rejected ones count as present) become REMOVED;
//   - finally every link from or to the subject is resolved again, so links
//     into a subject imported later start resolving now.
@Service
public class KbImportService {

    private static final Logger log = LoggerFactory.getLogger(KbImportService.class);

    private final KbPageRepository pages;
    private final KbPageRevisionRepository revisions;
    private final KbLinkRepository links;
    private final SubjectRepository subjects;
    private final DriveFileRepository files;

    public KbImportService(KbPageRepository pages, KbPageRevisionRepository revisions, KbLinkRepository links,
                           SubjectRepository subjects, DriveFileRepository files) {
        this.pages = pages;
        this.revisions = revisions;
        this.links = links;
        this.subjects = subjects;
        this.files = files;
    }

    @Transactional
    public KbImportResponse importSubject(String subjectId, KbImportRequest req) {
        if (!subjects.existsById(subjectId)) throw new ResourceNotFoundException("Subject", subjectId);

        // Parse everything first, so sources can be loaded in one query.
        record Entry(String slug, KbPageParser.Result parsed) {}
        var entries = new ArrayList<Entry>();
        var payloadSlugs = new HashSet<String>();
        var sourceIds = new LinkedHashSet<UUID>();
        for (var p : req.pages()) {
            var parsed = KbPageParser.parse(p.path(), p.content(), subjectId);
            var slug = KbPageParser.slugOf(p.path());
            if (!payloadSlugs.add(slug)) {
                var errors = new ArrayList<>(parsed.errors());
                errors.add(0, "duplicate slug in this import");
                parsed = new KbPageParser.Result(null, errors);
            }
            if (parsed.ok()) sourceIds.addAll(parsed.draft().sources());
            entries.add(new Entry(slug, parsed));
        }
        Map<UUID, KbValidator.SourceInfo> sourceInfo = new HashMap<>();
        for (DriveFile f : files.findAllById(sourceIds)) {
            sourceInfo.put(f.getId(), new KbValidator.SourceInfo(f.getId(),
                f.getPublication() == DrivePublication.PUBLISHED, f.getEffectiveSubjectId(), f.getTextContent()));
        }

        Map<String, KbPage> existing = new HashMap<>();
        for (var page : pages.findBySubjectId(subjectId)) existing.put(page.getSlug(), page);

        // Headings of the pages in this payload (they win over stored ones).
        Map<String, java.util.Set<String>> payloadAnchors = new HashMap<>();
        for (var e : entries) {
            if (e.parsed().ok()) payloadAnchors.put(e.slug(), KbWikilinks.headingAnchors(e.parsed().draft().body()));
        }

        var accepted = new ArrayList<String>();
        var rejected = new ArrayList<KbRejectedPage>();
        for (var e : entries) {
            if (!e.parsed().ok()) {
                rejected.add(new KbRejectedPage(e.slug(), e.parsed().errors()));
                continue;
            }
            var draft = e.parsed().draft();
            var errors = new ArrayList<>(KbValidator.validate(draft, sourceInfo));
            errors.addAll(anchorErrors(subjectId, draft, payloadAnchors));
            if (!errors.isEmpty()) {
                rejected.add(new KbRejectedPage(e.slug(), errors));
                continue;
            }
            upsert(subjectId, draft, existing.get(draft.slug()));
            accepted.add(draft.slug());
        }

        var removed = new ArrayList<String>();
        if (req.replace()) {
            for (var page : existing.values()) {
                if (payloadSlugs.contains(page.getSlug()) || page.getStatus() == KbPageStatus.REMOVED) continue;
                page.setStatus(KbPageStatus.REMOVED);
                removed.add(page.getSlug());
            }
            removed.sort(null);
        }

        links.resolveForSubject(subjectId);
        log.info("KB import {}: {} accepted, {} rejected, {} removed", subjectId, accepted.size(), rejected.size(),
            removed.size());
        return new KbImportResponse(accepted, rejected, removed);
    }

    // A #anchor must name a ## to #### heading of its target page when that
    // page exists (in this payload, else stored and not REMOVED); links to
    // pages that do not exist yet stay unresolved, as without anchors.
    private List<String> anchorErrors(String subjectId, KbPageParser.Draft draft,
                                      Map<String, java.util.Set<String>> payloadAnchors) {
        var errors = new ArrayList<String>();
        for (var l : draft.links().links()) {
            if (l.anchor() == null) continue;
            java.util.Set<String> anchors;
            if (l.subjectId().equals(subjectId) && payloadAnchors.containsKey(l.slug())) {
                anchors = payloadAnchors.get(l.slug());
            } else {
                var target = pages.findBySubjectIdAndSlug(l.subjectId(), l.slug())
                    .filter(p -> p.getStatus() != KbPageStatus.REMOVED);
                if (target.isEmpty()) continue;
                anchors = KbWikilinks.headingAnchors(target.get().getMarkdown());
            }
            if (!anchors.contains(l.anchor())) {
                errors.add("link [[" + l.raw() + "]]: no heading '#" + l.anchor() + "' in " + l.subjectId() + "/" + l.slug());
            }
        }
        return errors;
    }

    private void upsert(String subjectId, KbPageParser.Draft d, KbPage page) {
        if (page == null) {
            page = new KbPage(subjectId, d.slug());
            page.setContent(d.type(), d.title(), d.summary(), d.aliases(), d.body(), d.sources(), d.generator(),
                d.generatedAt());
            page = pages.save(page);
        } else {
            if (page.differsFrom(d.type(), d.title(), d.summary(), d.aliases(), d.body(), d.sources(), d.generator(),
                    d.generatedAt())) {
                revisions.save(KbPageRevision.of(page));
                page.setContent(d.type(), d.title(), d.summary(), d.aliases(), d.body(), d.sources(), d.generator(),
                    d.generatedAt());
                page.setRevision(page.getRevision() + 1);
            }
            if (page.getStatus() == KbPageStatus.REMOVED) page.setStatus(KbPageStatus.PUBLISHED);
            links.deleteAll(links.findByFromPageId(page.getId()));
            links.flush();
        }
        for (var l : d.links().links()) {
            links.save(new KbLink(page.getId(), truncate(l.raw(), 256), truncate(l.subjectId(), 25),
                truncate(l.slug(), 128)));
        }
    }

    private static String truncate(String s, int max) {
        return s.length() <= max ? s : s.substring(0, max);
    }
}
