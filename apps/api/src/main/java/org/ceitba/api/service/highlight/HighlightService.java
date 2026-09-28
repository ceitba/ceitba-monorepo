package org.ceitba.api.service.highlight;

import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.common.exception.ValidationException;
import org.ceitba.api.domain.HomeHighlight;
import org.ceitba.api.repository.HomeHighlightRepository;
import org.ceitba.api.web.highlight.dto.HighlightRequest;
import org.ceitba.api.web.highlight.dto.HighlightResponse;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

@Service
public class HighlightService {

    private final HomeHighlightRepository repository;
    private final Clock clock;

    public HighlightService(HomeHighlightRepository repository, Clock clock) {
        this.repository = repository;
        this.clock = clock;
    }

    // Public: what the app's home carousel should show right now.
    @Transactional(readOnly = true)
    public List<HighlightResponse> listVisible() {
        return repository.findVisible(OffsetDateTime.now(clock)).stream()
            .map(HighlightService::toResponse)
            .toList();
    }

    // STAFF: every highlight, including inactive, scheduled and expired ones.
    @Transactional(readOnly = true)
    public List<HighlightResponse> listAll() {
        return repository.findAllByOrderByPositionAscCreatedAtAsc().stream()
            .map(HighlightService::toResponse)
            .toList();
    }

    @Transactional
    public HighlightResponse create(HighlightRequest req) {
        var h = new HomeHighlight(req.title().trim(), req.imageUrl().trim());
        apply(h, req);
        return toResponse(repository.save(h));
    }

    @Transactional
    public HighlightResponse update(UUID id, HighlightRequest req) {
        var h = repository.findById(id)
            .orElseThrow(() -> new ResourceNotFoundException("Highlight", id.toString()));
        h.setTitle(req.title().trim());
        h.setImageUrl(req.imageUrl().trim());
        apply(h, req);
        return toResponse(repository.save(h));
    }

    @Transactional
    public void delete(UUID id) {
        if (!repository.existsById(id)) {
            throw new ResourceNotFoundException("Highlight", id.toString());
        }
        repository.deleteById(id);
    }

    private static void apply(HomeHighlight h, HighlightRequest req) {
        if (req.startsAt() != null && req.endsAt() != null && !req.startsAt().isBefore(req.endsAt())) {
            throw new ValidationException("startsAt", req.startsAt(), "must be before endsAt");
        }
        h.setDescription(blankToNull(req.description()));
        h.setLinkUrl(blankToNull(req.linkUrl()));
        h.setPosition(req.position());
        h.setStartsAt(req.startsAt());
        h.setEndsAt(req.endsAt());
        h.setActive(req.active() == null || req.active());
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    private static HighlightResponse toResponse(HomeHighlight h) {
        return new HighlightResponse(h.getId(), h.getTitle(), h.getDescription(),
            h.getImageUrl(), h.getLinkUrl(), h.getPosition(),
            h.getStartsAt(), h.getEndsAt(), h.isActive());
    }
}
