package org.ceitba.api.web.career;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.ceitba.api.service.career.CareerService;
import org.ceitba.api.web.career.dto.CareerResponse;
import org.ceitba.api.web.career.dto.CreateCareerRequest;
import org.ceitba.api.web.career.dto.CreatePlanRequest;
import org.ceitba.api.web.career.dto.PlanResponse;
import org.ceitba.api.web.career.dto.UpdateCareerRequest;
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
import java.util.Map;

@Tag(name = "Careers")
@RestController
@RequestMapping("/v1/careers")
public class CareerController {

    private final CareerService careerService;

    public CareerController(CareerService careerService) {
        this.careerService = careerService;
    }

    @GetMapping("/plans")
    @Operation(summary = "Get careers with their plans")
    public Map<String, CareerResponse> getCareersWithPlans() {
        return careerService.getCareersWithPlans();
    }

    @GetMapping
    @Operation(summary = "Get all careers")
    public List<CareerResponse> getAllCareers() {
        return careerService.getAllCareers();
    }

    @GetMapping("/{id}")
    @Operation(summary = "Get career by ID")
    public CareerResponse getCareerById(@PathVariable String id) {
        return careerService.getCareerById(id);
    }

    // Writes: STAFF only. Careers are normally upserted by the data-sync job;
    // these are escape hatches for ad-hoc admin work.
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasRole('STAFF')")
    @SecurityRequirement(name = "bearerAuth")
    @Operation(summary = "Create a career (STAFF only)")
    public CareerResponse createCareer(@Valid @RequestBody CreateCareerRequest req) {
        return careerService.create(req);
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasRole('STAFF')")
    @SecurityRequirement(name = "bearerAuth")
    @Operation(summary = "Update a career's name (STAFF only)")
    public CareerResponse updateCareer(@PathVariable String id, @Valid @RequestBody UpdateCareerRequest req) {
        return careerService.update(id, req);
    }

    @PostMapping("/{id}/plans")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasRole('STAFF')")
    @SecurityRequirement(name = "bearerAuth")
    @Operation(summary = "Add a plan to a career (STAFF only). 409 if the plan id is already used.")
    public PlanResponse addPlan(@PathVariable String id, @Valid @RequestBody CreatePlanRequest req) {
        return careerService.addPlan(id, req);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("hasRole('STAFF')")
    @SecurityRequirement(name = "bearerAuth")
    @Operation(summary = "Delete a career (STAFF only). Returns 409 if it has plans/notes/users.")
    public void deleteCareer(@PathVariable String id) {
        careerService.delete(id);
    }
}
