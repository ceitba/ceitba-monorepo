package org.ceitba.api.service.career;

import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.repository.CareerRepository;
import org.ceitba.api.repository.PlanRepository;
import org.ceitba.api.web.career.dto.CareerResponse;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class CareerService {

    private final CareerRepository careerRepository;
    private final PlanRepository planRepository;

    public CareerService(CareerRepository careerRepository, PlanRepository planRepository) {
        this.careerRepository = careerRepository;
        this.planRepository = planRepository;
    }

    @Transactional(readOnly = true)
    public List<CareerResponse> getAllCareers() {
        return careerRepository.findAll(Sort.by("id")).stream()
            .map(c -> new CareerResponse(c.getId(), c.getName(), List.of()))
            .toList();
    }

    @Transactional(readOnly = true)
    public CareerResponse getCareerById(String id) {
        var career = careerRepository.findById(id)
            .orElseThrow(() -> new ResourceNotFoundException("Career", id));
        return new CareerResponse(career.getId(), career.getName(), List.of());
    }

    // Mirrors NestJS getCareersWithPlans — keyed by careerId, plans populated.
    // LinkedHashMap preserves the id-sorted order; Map.copyOf would lose it.
    @Transactional(readOnly = true)
    public Map<String, CareerResponse> getCareersWithPlans() {
        var result = new LinkedHashMap<String, CareerResponse>();
        for (var career : careerRepository.findAll(Sort.by("id"))) {
            var planIds = planRepository.findByCareer_Id(career.getId()).stream()
                .map(p -> p.getId())
                .toList();
            result.put(career.getId(), new CareerResponse(career.getId(), career.getName(), planIds));
        }
        return result;
    }
}
