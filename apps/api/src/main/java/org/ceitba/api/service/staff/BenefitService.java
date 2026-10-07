package org.ceitba.api.service.staff;

import org.ceitba.api.common.exception.ResourceAlreadyExistsException;
import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.domain.Benefit;
import org.ceitba.api.repository.BenefitRepository;
import org.ceitba.api.web.staff.dto.BenefitResponse;
import org.ceitba.api.web.staff.dto.UpdateBenefitRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.regex.Pattern;

@Service
public class BenefitService {

    // Same rule as OrganizationRequest.slug.
    private static final Pattern SLUG = Pattern.compile("^[a-z0-9]+(-[a-z0-9]+)*$");

    private final BenefitRepository repository;

    public BenefitService(BenefitRepository repository) {
        this.repository = repository;
    }

    @Transactional(readOnly = true)
    public List<BenefitResponse> list() {
        return repository.findAllByOrderByDisplayOrderAsc().stream()
            .map(this::toResponse)
            .toList();
    }

    @Transactional
    public BenefitResponse create(String slug, UpdateBenefitRequest req) {
        if (slug == null || slug.length() < 2 || slug.length() > 40 || !SLUG.matcher(slug).matches()) {
            throw new InvalidBenefitSlugException(slug);
        }
        if (repository.existsById(slug)) {
            throw new ResourceAlreadyExistsException("Benefit", slug);
        }
        var b = new Benefit(slug, req.colorVar(), req.displayOrder());
        applyTo(b, req);
        return toResponse(repository.save(b));
    }

    @Transactional
    public BenefitResponse update(String slug, UpdateBenefitRequest req) {
        var b = repository.findById(slug)
            .orElseThrow(() -> new ResourceNotFoundException("Benefit", slug));
        b.setColorVar(req.colorVar());
        applyTo(b, req);
        return toResponse(repository.save(b));
    }

    @Transactional
    public void delete(String slug) {
        if (!repository.existsById(slug)) {
            throw new ResourceNotFoundException("Benefit", slug);
        }
        repository.deleteById(slug);
    }

    private void applyTo(Benefit b, UpdateBenefitRequest req) {
        b.setDisplayOrder(req.displayOrder());
        b.setLinkUrl(req.linkUrl());
        b.setContactEmail(req.contactEmail());
        b.setHighlightsEs(req.highlightsEs());
        b.setHighlightsEn(req.highlightsEn());
        // Names postdate the SPA's editor, which omits them: null keeps the
        // stored value so an SPA save doesn't wipe them; send "" to clear.
        if (req.nameEs() != null) b.setNameEs(blankToNull(req.nameEs()));
        if (req.nameEn() != null) b.setNameEn(blankToNull(req.nameEn()));
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    private BenefitResponse toResponse(Benefit b) {
        return new BenefitResponse(
            b.getSlug(), b.getColorVar(), b.getDisplayOrder(),
            b.getLinkUrl(), b.getContactEmail(),
            b.getHighlightsEs(), b.getHighlightsEn(),
            b.getNameEs(), b.getNameEn()
        );
    }
}
