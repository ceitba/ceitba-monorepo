package org.ceitba.api.service.kb;

import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.common.exception.ValidationException;
import org.ceitba.api.domain.kb.KbPageStatus;
import org.ceitba.api.repository.kb.KbPageReportRepository;
import org.ceitba.api.repository.kb.KbPageRepository;
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

// STAFF moderation of subject wikis, and the takedown hook the Drive
// moderation calls when a cited file is removed by staff or its source is
// blocked.
@Service
public class KbModerationService {

    private static final Logger log = LoggerFactory.getLogger(KbModerationService.class);

    static final int MAX_LIMIT = 100;

    private final KbPageRepository pages;
    private final KbPageReportRepository reports;
    private final KbViews views;

    public KbModerationService(KbPageRepository pages, KbPageReportRepository reports, KbViews views) {
        this.pages = pages;
        this.reports = reports;
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
    // Runs inside the caller's transaction (DriveModerationService).
    @Transactional
    public int hidePagesCiting(Collection<UUID> fileIds) {
        if (fileIds.isEmpty()) return 0;
        var literal = fileIds.stream().map(UUID::toString).collect(Collectors.joining(",", "{", "}"));
        var citing = pages.findPublishedCitingAny(literal);
        citing.forEach(p -> p.hide(org.ceitba.api.domain.kb.KbHiddenReason.TAKEDOWN));
        if (!citing.isEmpty()) log.info("KB takedown: {} pages hidden", citing.size());
        return citing.size();
    }
}
