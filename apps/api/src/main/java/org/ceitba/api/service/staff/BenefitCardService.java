package org.ceitba.api.service.staff;

import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.domain.BenefitCard;
import org.ceitba.api.repository.BenefitCardRepository;
import org.ceitba.api.repository.BenefitRepository;
import org.ceitba.api.web.staff.dto.BenefitCardResponse;
import org.ceitba.api.web.staff.dto.CreateBenefitCardRequest;
import org.ceitba.api.web.staff.dto.UpdateBenefitCardRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Service
public class BenefitCardService {

    private final BenefitCardRepository repository;
    private final BenefitRepository categoryRepository;

    public BenefitCardService(BenefitCardRepository repository,
                              BenefitRepository categoryRepository) {
        this.repository = repository;
        this.categoryRepository = categoryRepository;
    }

    @Transactional(readOnly = true)
    public List<BenefitCardResponse> list() {
        return repository.findAllByOrderByDisplayOrderAscTitleEsAsc().stream()
            .map(this::toResponse)
            .toList();
    }

    @Transactional
    public BenefitCardResponse create(CreateBenefitCardRequest req) {
        requireCategory(req.categorySlug());
        var c = new BenefitCard(req.categorySlug(), req.titleEs(), req.titleEn());
        c.setDisplayOrder(req.displayOrder());
        c.setSummaryEs(req.summaryEs());
        c.setSummaryEn(req.summaryEn());
        c.setImageUrl(blankToNull(req.imageUrl()));
        c.setCtaUrl(blankToNull(req.ctaUrl()));
        c.setCtaLabelEs(blankToNull(req.ctaLabelEs()));
        c.setCtaLabelEn(blankToNull(req.ctaLabelEn()));
        c.setPrice(blankToNull(req.price()));
        c.setBulletsEs(cleanList(req.bulletsEs()));
        c.setBulletsEn(cleanList(req.bulletsEn()));
        return toResponse(repository.save(c));
    }

    @Transactional
    public BenefitCardResponse update(UUID id, UpdateBenefitCardRequest req) {
        var c = repository.findById(id)
            .orElseThrow(() -> new ResourceNotFoundException("BenefitCard", id.toString()));
        requireCategory(req.categorySlug());
        c.setCategorySlug(req.categorySlug());
        c.setDisplayOrder(req.displayOrder());
        c.setTitleEs(req.titleEs());
        c.setTitleEn(req.titleEn());
        c.setSummaryEs(req.summaryEs());
        c.setSummaryEn(req.summaryEn());
        c.setImageUrl(blankToNull(req.imageUrl()));
        c.setCtaUrl(blankToNull(req.ctaUrl()));
        c.setCtaLabelEs(blankToNull(req.ctaLabelEs()));
        c.setCtaLabelEn(blankToNull(req.ctaLabelEn()));
        c.setPrice(blankToNull(req.price()));
        c.setBulletsEs(cleanList(req.bulletsEs()));
        c.setBulletsEn(cleanList(req.bulletsEn()));
        return toResponse(repository.save(c));
    }

    @Transactional
    public void delete(UUID id) {
        if (!repository.existsById(id)) {
            throw new ResourceNotFoundException("BenefitCard", id.toString());
        }
        repository.deleteById(id);
    }

    private void requireCategory(String slug) {
        if (!categoryRepository.existsById(slug)) {
            throw new ResourceNotFoundException("Benefit", slug);
        }
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s;
    }

    private static List<String> cleanList(List<String> in) {
        if (in == null) return new ArrayList<>();
        return in.stream().filter(s -> s != null && !s.isBlank()).map(String::trim).toList();
    }

    private BenefitCardResponse toResponse(BenefitCard c) {
        return new BenefitCardResponse(
            c.getId(),
            c.getCategorySlug(),
            c.getDisplayOrder(),
            c.getTitleEs(),
            c.getTitleEn(),
            c.getSummaryEs(),
            c.getSummaryEn(),
            c.getImageUrl(),
            c.getCtaUrl(),
            c.getCtaLabelEs(),
            c.getCtaLabelEn(),
            c.getPrice(),
            c.getBulletsEs(),
            c.getBulletsEn()
        );
    }
}
