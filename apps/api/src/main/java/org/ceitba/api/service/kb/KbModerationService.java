package org.ceitba.api.service.kb;

import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.common.exception.ValidationException;
import org.ceitba.api.domain.kb.KbPageStatus;
import org.ceitba.api.repository.kb.KbEvalSetRepository;
import org.ceitba.api.repository.kb.KbFileDigestRepository;
import org.ceitba.api.repository.kb.KbPageReportRepository;
import org.ceitba.api.repository.kb.KbPageRepository;
import org.ceitba.api.repository.kb.KbRunRequestRepository;
import org.ceitba.api.service.drive.DriveStorageJanitor;
import org.ceitba.api.web.drive.dto.PageResponse;
import org.ceitba.api.web.kb.dto.KbPageResponse;
import org.ceitba.api.web.kb.dto.KbStaffPageResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;
import java.util.Locale;
import java.util.UUID;
import java.util.stream.Collectors;

// STAFF moderation of subject wikis, and the hooks Drive calls:
//   hidePagesCiting  takedown, whenever a cited file stops being public
//                    (DriveRecalculator: staff removal/block, 3 reports,
//                    hidden by the student, moved to another subject,
//                    revoked) or is deleted (forgetFiles)
//   forgetFiles      a file row is about to be deleted (disconnect, account
//                    deletion, 30-day purge): takedown plus its digests and
//                    the raw text of its DIGEST requests.
// The pipeline rewrites the affected subjects on its next run: their
// published inputs changed, which is what makes a subject dirty (KbInputs).
@Service
public class KbModerationService {

    private static final Logger log = LoggerFactory.getLogger(KbModerationService.class);

    static final int MAX_LIMIT = 100;

    private final KbPageRepository pages;
    private final KbPageReportRepository reports;
    private final KbFileDigestRepository digests;
    private final KbRunRequestRepository requests;
    private final KbEvalSetRepository evalSets;
    private final DriveStorageJanitor janitor;
    private final KbViews views;

    public KbModerationService(KbPageRepository pages, KbPageReportRepository reports,
                               KbFileDigestRepository digests, KbRunRequestRepository requests,
                               KbEvalSetRepository evalSets, DriveStorageJanitor janitor, KbViews views) {
        this.pages = pages;
        this.reports = reports;
        this.digests = digests;
        this.requests = requests;
        this.evalSets = evalSets;
        this.janitor = janitor;
        this.views = views;
    }

    @Transactional
    public KbPageResponse hide(UUID staffId, UUID pageId) {
        var page = pages.findById(pageId).orElseThrow(() -> new ResourceNotFoundException("KbPage", pageId.toString()));
        if (page.getStatus() == KbPageStatus.PUBLISHED) page.hide(org.ceitba.api.domain.kb.KbHiddenReason.STAFF);
        return views.page(page, staffId, true);
    }

    // Back to PUBLISHED; its reports are dismissed (count back to 0).
    @Transactional
    public KbPageResponse restore(UUID staffId, UUID pageId) {
        var page = pages.findById(pageId).orElseThrow(() -> new ResourceNotFoundException("KbPage", pageId.toString()));
        page.setStatus(KbPageStatus.PUBLISHED);
        reports.deleteByPageId(pageId);
        page.setReportCount(0);
        return views.page(page, staffId, true);
    }

    // status null: HIDDEN.
    @Transactional(readOnly = true)
    public PageResponse<KbStaffPageResponse> list(String status, int page, int limit) {
        KbPageStatus st;
        try {
            st = status == null || status.isBlank() ? KbPageStatus.HIDDEN
                : KbPageStatus.valueOf(status.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new ValidationException("status", status, "must be PUBLISHED, HIDDEN or REMOVED");
        }
        var result = pages.findByStatusOrderByUpdatedAtDescIdAsc(st,
            PageRequest.of(Math.max(page, 0), Math.max(1, Math.min(limit, MAX_LIMIT))));
        return new PageResponse<>(result.getContent().stream().map(KbViews::staff).toList(), result.getTotalElements());
    }

    // Takedown: every PUBLISHED page citing one of `fileIds` becomes HIDDEN.
    // Runs inside the caller's transaction.
    @Transactional
    public int hidePagesCiting(Collection<UUID> fileIds) {
        if (fileIds.isEmpty()) return 0;
        var literal = fileIds.stream().map(UUID::toString).collect(Collectors.joining(",", "{", "}"));
        var citing = pages.findPublishedCitingAny(literal);
        citing.forEach(p -> p.hide(org.ceitba.api.domain.kb.KbHiddenReason.TAKEDOWN));
        if (!citing.isEmpty()) log.info("KB takedown: {} pages hidden", citing.size());
        return citing.size();
    }

    // The files are being deleted: pages citing them go hidden, their digests
    // go, the raw text/digest of their DIGEST requests is redacted and the
    // eval sets' frozen copies of their text are deleted after commit (the
    // runs' JSONL in object storage expires with KbRunRetentionService).
    // Runs inside the caller's transaction, before the rows are deleted.
    @Transactional
    public void forgetFiles(Collection<UUID> fileIds) {
        if (fileIds.isEmpty()) return;
        hidePagesCiting(fileIds);
        digests.deleteByFileIds(fileIds);
        var ids = fileIds.stream().map(UUID::toString).collect(Collectors.toSet());
        requests.redactDigestRequests(ids);
        var keys = new java.util.ArrayList<String>();
        for (var set : evalSets.findAll()) {
            var frozen = set.getFrozenInputs();
            if (frozen == null) continue;
            frozen.forEach(subject -> subject.forEach(input -> {
                var fileId = input.path("fileId").asText();
                if (ids.contains(fileId)) keys.add("kb/evals/sets/" + set.getId() + "/" + fileId + ".txt");
            }));
        }
        janitor.deleteAfterCommit(keys);
    }
}
