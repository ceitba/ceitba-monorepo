package org.ceitba.api.web.staff;

import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.ceitba.api.service.staff.BenefitCardService;
import org.ceitba.api.web.staff.dto.BenefitCardResponse;
import org.ceitba.api.web.staff.dto.CreateBenefitCardRequest;
import org.ceitba.api.web.staff.dto.UpdateBenefitCardRequest;
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
import java.util.UUID;

@Tag(name = "Benefit Cards")
@RestController
@RequestMapping("/v1/benefit-cards")
public class BenefitCardController {

    private final BenefitCardService service;

    public BenefitCardController(BenefitCardService service) {
        this.service = service;
    }

    @GetMapping
    public List<BenefitCardResponse> list() {
        return service.list();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasRole('STAFF')")
    public BenefitCardResponse create(@Valid @RequestBody CreateBenefitCardRequest req) {
        return service.create(req);
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasRole('STAFF')")
    public BenefitCardResponse update(@PathVariable UUID id,
                                       @Valid @RequestBody UpdateBenefitCardRequest req) {
        return service.update(id, req);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("hasRole('STAFF')")
    public void delete(@PathVariable UUID id) {
        service.delete(id);
    }
}
