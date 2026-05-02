package org.ceitba.api.web.career;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.ceitba.api.service.career.CareerService;
import org.ceitba.api.web.career.dto.CareerResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
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
}
