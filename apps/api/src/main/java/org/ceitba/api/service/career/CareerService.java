package org.ceitba.api.service.career;

import org.ceitba.api.common.exception.ResourceAlreadyExistsException;
import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.domain.Career;
import org.ceitba.api.repository.CareerRepository;
import org.ceitba.api.repository.PlanRepository;
import org.ceitba.api.web.career.dto.CareerResponse;
import org.ceitba.api.web.career.dto.CreateCareerRequest;
import org.ceitba.api.web.career.dto.UpdateCareerRequest;
import org.springframework.dao.DataIntegrityViolationException;
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

    @Transactional
    public CareerResponse create(CreateCareerRequest req) {
        if (careerRepository.existsById(req.id())) {
            throw new ResourceAlreadyExistsException("Career", req.id());
        }
        try {
            var saved = careerRepository.save(new Career(req.id(), req.name()));
            return new CareerResponse(saved.getId(), saved.getName(), List.of());
        } catch (DataIntegrityViolationException race) {
            throw new ResourceAlreadyExistsException("Career", req.id());
        }
    }

    @Transactional
    public CareerResponse update(String id, UpdateCareerRequest req) {
        var career = careerRepository.findById(id)
            .orElseThrow(() -> new ResourceNotFoundException("Career", id));
        career.setName(req.name());
        var saved = careerRepository.save(career);
        // Plans aren't fetched here — callers asking for the full shape can
        // hit GET /v1/careers/plans afterwards. Update returns a thin echo,
        // matching the NestJS shape.
        return new CareerResponse(saved.getId(), saved.getName(), List.of());
    }

    // GlobalExceptionHandler already maps DataIntegrityViolationException to a
    // 409 with a generic body — perfect for the "career still has plans / users
    // / career_notes" RESTRICT case.
    @Transactional
    public void delete(String id) {
        if (!careerRepository.existsById(id)) {
            throw new ResourceNotFoundException("Career", id);
        }
        careerRepository.deleteById(id);
    }
}
