package org.ceitba.api.web.staff;

import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.ceitba.api.service.staff.BenefitService;
import org.ceitba.api.web.staff.dto.BenefitResponse;
import org.ceitba.api.web.staff.dto.UpdateBenefitRequest;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@Tag(name = "Benefits")
@RestController
@RequestMapping("/v1/benefits")
public class BenefitController {

    private final BenefitService service;

    public BenefitController(BenefitService service) {
        this.service = service;
    }

    @GetMapping
    public List<BenefitResponse> list() {
        return service.list();
    }

    @PostMapping("/{slug}")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasRole('STAFF')")
    public BenefitResponse create(@PathVariable String slug,
                                   @Valid @RequestBody UpdateBenefitRequest req) {
        return service.create(slug, req);
    }

    @PutMapping("/{slug}")
    @PreAuthorize("hasRole('STAFF')")
    public BenefitResponse update(@PathVariable String slug,
                                   @Valid @RequestBody UpdateBenefitRequest req) {
        return service.update(slug, req);
    }

    @DeleteMapping("/{slug}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("hasRole('STAFF')")
    public void delete(@PathVariable String slug) {
        service.delete(slug);
    }
}
