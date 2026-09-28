package org.ceitba.api.web.staff;

import com.jayway.jsonpath.JsonPath;
import org.ceitba.api.domain.Benefit;
import org.ceitba.api.domain.BenefitCard;
import org.ceitba.api.repository.BenefitCardRepository;
import org.ceitba.api.repository.BenefitRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.util.UUID;

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
@Testcontainers
@TestPropertySource(properties = "auth.allowed-domains=itba.edu.ar")
class BenefitCardControllerIT {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @DynamicPropertySource
    static void datasourceProps(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired MockMvc mvc;
    @Autowired BenefitRepository categoryRepository;
    @Autowired BenefitCardRepository repository;

    private static final String FULL_BODY = """
        {"categorySlug":"convenios","displayOrder":1,"titleEs":"Gimnasio X","titleEn":"Gym X",
         "summaryEs":"Descuento","bulletsEs":["20% off"," ","Pase libre"],
         "ctaUrl":"https://gym.example/inscripcion",
         "location":"Av. Madero 399","locationUrl":"https://maps.example/?q=madero",
         "phone":"+54 11 1234-5678","website":"https://gym.example","email":"hola@gym.example"}""";

    @BeforeEach
    void seed() {
        repository.deleteAll();
        categoryRepository.deleteAll();
        categoryRepository.save(new Benefit("convenios", "--dept-color-media", 1));
        categoryRepository.save(new Benefit("idiomas", "--dept-color-infra", 2));
    }

    private static RequestPostProcessor user() {
        return jwt().jwt(t -> t.claim("email", "regular@itba.edu.ar"))
            .authorities(new SimpleGrantedAuthority("ROLE_USER"));
    }

    private static RequestPostProcessor staff() {
        return jwt().jwt(t -> t.claim("email", "boss@itba.edu.ar"))
            .authorities(new SimpleGrantedAuthority("ROLE_USER"), new SimpleGrantedAuthority("ROLE_STAFF"));
    }

    private String createFull() throws Exception {
        var json = mvc.perform(post("/v1/benefit-cards").with(staff())
                .contentType(MediaType.APPLICATION_JSON).content(FULL_BODY))
            .andExpect(status().isCreated())
            .andReturn().getResponse().getContentAsString();
        return JsonPath.read(json, "$.id");
    }

    @Test
    void publicListIsOrdered() throws Exception {
        var b = new BenefitCard("idiomas", "B inglés", "B english");
        b.setDisplayOrder(2);
        repository.save(b);
        var a = new BenefitCard("convenios", "A gym", "A gym");
        a.setDisplayOrder(1);
        repository.save(a);

        mvc.perform(get("/v1/benefit-cards"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[*].titleEs", contains("A gym", "B inglés")))
            .andExpect(jsonPath("$[0].phone").doesNotExist());
    }

    @Test
    void staffCreatesCardWithContactFields() throws Exception {
        createFull();
        mvc.perform(get("/v1/benefit-cards"))
            .andExpect(jsonPath("$.length()").value(1))
            .andExpect(jsonPath("$[0].categorySlug").value("convenios"))
            .andExpect(jsonPath("$[0].bulletsEs", contains("20% off", "Pase libre")))
            .andExpect(jsonPath("$[0].ctaUrl").value("https://gym.example/inscripcion"))
            .andExpect(jsonPath("$[0].location").value("Av. Madero 399"))
            .andExpect(jsonPath("$[0].locationUrl").value("https://maps.example/?q=madero"))
            .andExpect(jsonPath("$[0].phone").value("+54 11 1234-5678"))
            .andExpect(jsonPath("$[0].website").value("https://gym.example"))
            .andExpect(jsonPath("$[0].email").value("hola@gym.example"));
    }

    @Test
    void writesRequireStaff() throws Exception {
        var card = repository.save(new BenefitCard("convenios", "x", "x"));
        mvc.perform(post("/v1/benefit-cards").contentType(MediaType.APPLICATION_JSON).content(FULL_BODY))
            .andExpect(status().isUnauthorized());
        mvc.perform(post("/v1/benefit-cards").with(user()).contentType(MediaType.APPLICATION_JSON).content(FULL_BODY))
            .andExpect(status().isForbidden());
        mvc.perform(put("/v1/benefit-cards/" + card.getId()).with(user())
                .contentType(MediaType.APPLICATION_JSON).content(FULL_BODY))
            .andExpect(status().isForbidden());
        mvc.perform(delete("/v1/benefit-cards/" + card.getId()).with(user()))
            .andExpect(status().isForbidden());
        assertThat(repository.count()).isEqualTo(1);
    }

    @Test
    void updateWithoutContactFieldsKeepsThemAndBlankClears() throws Exception {
        var id = createFull();

        // Shape the SPA editor sends: no contact fields.
        mvc.perform(put("/v1/benefit-cards/" + id).with(staff()).contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"categorySlug":"idiomas","displayOrder":4,"titleEs":"Inglés","titleEn":"English"}"""))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.categorySlug").value("idiomas"))
            .andExpect(jsonPath("$.titleEs").value("Inglés"))
            .andExpect(jsonPath("$.phone").value("+54 11 1234-5678"))
            .andExpect(jsonPath("$.email").value("hola@gym.example"));

        mvc.perform(put("/v1/benefit-cards/" + id).with(staff()).contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"categorySlug":"idiomas","displayOrder":4,"titleEs":"Inglés","titleEn":"English",
                     "phone":"","email":"","website":"https://new.example","locationUrl":""}"""))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.phone").doesNotExist())
            .andExpect(jsonPath("$.email").doesNotExist())
            .andExpect(jsonPath("$.website").value("https://new.example"))
            .andExpect(jsonPath("$.location").value("Av. Madero 399"))
            .andExpect(jsonPath("$.locationUrl").doesNotExist());

        mvc.perform(put("/v1/benefit-cards/" + id).with(staff()).contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"categorySlug":"idiomas","displayOrder":4,"titleEs":"Inglés","titleEn":"English",
                     "website":"gym.example"}"""))
            .andExpect(status().isBadRequest());
    }

    @Test
    void invalidRequestsAreRejected() throws Exception {
        mvc.perform(post("/v1/benefit-cards").with(staff()).contentType(MediaType.APPLICATION_JSON)
                .content(FULL_BODY.replace("hola@gym.example", "not-an-email")))
            .andExpect(status().isBadRequest());
        mvc.perform(post("/v1/benefit-cards").with(staff()).contentType(MediaType.APPLICATION_JSON)
                .content(FULL_BODY.replace("+54 11 1234-5678", "9".repeat(65))))
            .andExpect(status().isBadRequest());
        mvc.perform(post("/v1/benefit-cards").with(staff()).contentType(MediaType.APPLICATION_JSON)
                .content(FULL_BODY.replace("https://gym.example\",\"email", "javascript:alert(1)\",\"email")))
            .andExpect(status().isBadRequest());
        mvc.perform(post("/v1/benefit-cards").with(staff()).contentType(MediaType.APPLICATION_JSON)
                .content(FULL_BODY.replace("https://maps.example/?q=madero", "intent://maps#Intent;end")))
            .andExpect(status().isBadRequest());
        mvc.perform(post("/v1/benefit-cards").with(staff()).contentType(MediaType.APPLICATION_JSON)
                .content(FULL_BODY.replace("\"convenios\"", "\"nope\"")))
            .andExpect(status().isNotFound());
        assertThat(repository.count()).isZero();
    }

    @Test
    void staffDeletesAndUnknownIs404() throws Exception {
        var id = createFull();
        mvc.perform(delete("/v1/benefit-cards/" + id).with(staff())).andExpect(status().isNoContent());
        mvc.perform(delete("/v1/benefit-cards/" + id).with(staff())).andExpect(status().isNotFound());
        mvc.perform(put("/v1/benefit-cards/" + UUID.randomUUID()).with(staff())
                .contentType(MediaType.APPLICATION_JSON).content(FULL_BODY))
            .andExpect(status().isNotFound());
    }
}
