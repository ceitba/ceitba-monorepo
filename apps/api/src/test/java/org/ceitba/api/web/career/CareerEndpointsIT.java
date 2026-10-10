package org.ceitba.api.web.career;

import org.ceitba.api.domain.Career;
import org.ceitba.api.domain.Plan;
import org.ceitba.api.repository.CareerRepository;
import org.ceitba.api.repository.PlanRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class CareerEndpointsIT {

    @Autowired MockMvc mvc;
    @Autowired CareerRepository careerRepository;
    @Autowired PlanRepository planRepository;

    @BeforeEach
    void seed() {
        planRepository.deleteAll();
        careerRepository.deleteAll();

        var s = careerRepository.save(new Career("S", "Sistemas"));
        var i = careerRepository.save(new Career("I", "Industrial"));
        planRepository.save(new Plan("S10-Rev23", s, "Plan 2023"));
        planRepository.save(new Plan("S10-Rev18", s, "Plan 2018"));
        planRepository.save(new Plan("I07-Rev22", i, "Plan 2022"));
    }

    @Test
    void getAllCareersReturnsListWithEmptyPlansArrays() throws Exception {
        mvc.perform(get("/v1/careers"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(2))
            .andExpect(jsonPath("$[0].id").value("I"))   // sorted by id ASC
            .andExpect(jsonPath("$[0].name").value("Industrial"))
            .andExpect(jsonPath("$[0].plans").isArray())
            .andExpect(jsonPath("$[0].plans.length()").value(0))
            .andExpect(jsonPath("$[1].id").value("S"));
    }

    @Test
    void getCareerByIdReturnsTheOne() throws Exception {
        mvc.perform(get("/v1/careers/S"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.id").value("S"))
            .andExpect(jsonPath("$.name").value("Sistemas"))
            .andExpect(jsonPath("$.plans.length()").value(0));
    }

    @Test
    void getCareerByUnknownIdReturns404() throws Exception {
        mvc.perform(get("/v1/careers/NOPE"))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.error").value("ResourceNotFound"))
            .andExpect(jsonPath("$.message").value("Career with identifier 'NOPE' not found"));
    }

    @Test
    void getCareersWithPlansReturnsMapKeyedByIdWithPlanIdArrays() throws Exception {
        mvc.perform(get("/v1/careers/plans"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.S.id").value("S"))
            .andExpect(jsonPath("$.S.name").value("Sistemas"))
            .andExpect(jsonPath("$.S.plans.length()").value(2))
            // Seeded Rev23 first; the response is sorted by plan id.
            .andExpect(jsonPath("$.S.plans[0]").value("S10-Rev18"))
            .andExpect(jsonPath("$.S.plans[1]").value("S10-Rev23"))
            .andExpect(jsonPath("$.I.plans.length()").value(1))
            .andExpect(jsonPath("$.I.plans[0]").value("I07-Rev22"));
    }
}
