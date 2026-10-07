package org.ceitba.api.web.staff;

import org.ceitba.api.domain.Benefit;
import org.ceitba.api.repository.BenefitCardRepository;
import org.ceitba.api.repository.BenefitRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class BenefitControllerIT {

    @Autowired MockMvc mvc;
    @Autowired BenefitRepository repository;
    @Autowired BenefitCardRepository cardRepository;

    @BeforeEach
    void seed() {
        cardRepository.deleteAll();
        repository.deleteAll();
        var deportes = new Benefit("deportes", "--dept-color-deportes", 1);
        deportes.setNameEs("Deportes");
        deportes.setNameEn("Sports");
        repository.save(deportes);
        repository.save(new Benefit("academico", "--dept-color-infra", 0));
    }

    private static RequestPostProcessor user() {
        return jwt().jwt(t -> t.claim("email", "regular@itba.edu.ar"))
            .authorities(new SimpleGrantedAuthority("ROLE_USER"));
    }

    private static RequestPostProcessor staff() {
        return jwt().jwt(t -> t.claim("email", "boss@itba.edu.ar"))
            .authorities(new SimpleGrantedAuthority("ROLE_USER"), new SimpleGrantedAuthority("ROLE_STAFF"));
    }

    @Test
    void publicListIsOrderedAndIncludesNames() throws Exception {
        mvc.perform(get("/v1/benefits"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[*].slug", contains("academico", "deportes")))
            .andExpect(jsonPath("$[0].nameEs").doesNotExist())
            .andExpect(jsonPath("$[1].nameEs").value("Deportes"))
            .andExpect(jsonPath("$[1].nameEn").value("Sports"));
    }

    @Test
    void writesRequireStaff() throws Exception {
        var body = """
            {"colorVar":"--x","displayOrder":6,"nameEs":"Convenios","nameEn":"Partnerships"}""";
        mvc.perform(post("/v1/benefits/convenios").contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isUnauthorized());
        mvc.perform(post("/v1/benefits/convenios").with(user()).contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isForbidden());
        mvc.perform(put("/v1/benefits/deportes").with(user()).contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isForbidden());
        mvc.perform(delete("/v1/benefits/deportes").with(user()))
            .andExpect(status().isForbidden());
        assertThat(repository.existsById("convenios")).isFalse();
    }

    @Test
    void staffCreatesCategoryWithNames() throws Exception {
        var body = """
            {"colorVar":"--dept-color-media","displayOrder":6,"nameEs":"Convenios","nameEn":"Partnerships"}""";
        mvc.perform(post("/v1/benefits/convenios").with(staff())
                .contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.slug").value("convenios"))
            .andExpect(jsonPath("$.nameEs").value("Convenios"))
            .andExpect(jsonPath("$.nameEn").value("Partnerships"));

        mvc.perform(post("/v1/benefits/convenios").with(staff())
                .contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isConflict());
    }

    @Test
    void updateWithoutNamesKeepsThemAndBlankClears() throws Exception {
        // The SPA editor predates the name fields and omits them.
        mvc.perform(put("/v1/benefits/deportes").with(staff()).contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"colorVar":"--dept-color-deportes","displayOrder":3,"highlightsEs":["Gimnasio"]}"""))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.displayOrder").value(3))
            .andExpect(jsonPath("$.highlightsEs[0]").value("Gimnasio"))
            .andExpect(jsonPath("$.nameEs").value("Deportes"))
            .andExpect(jsonPath("$.nameEn").value("Sports"));

        mvc.perform(put("/v1/benefits/deportes").with(staff()).contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"colorVar":"--dept-color-deportes","displayOrder":3,"nameEs":"Deportes y más","nameEn":""}"""))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.nameEs").value("Deportes y más"))
            .andExpect(jsonPath("$.nameEn").doesNotExist());
    }

    @Test
    void staffDeletesAndUnknownIs404() throws Exception {
        mvc.perform(delete("/v1/benefits/academico").with(staff())).andExpect(status().isNoContent());
        mvc.perform(delete("/v1/benefits/academico").with(staff())).andExpect(status().isNotFound());
        mvc.perform(put("/v1/benefits/nope").with(staff()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"colorVar\":\"--x\",\"displayOrder\":0}"))
            .andExpect(status().isNotFound());
    }
}
