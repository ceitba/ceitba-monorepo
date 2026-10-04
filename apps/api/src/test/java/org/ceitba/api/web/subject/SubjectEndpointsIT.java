package org.ceitba.api.web.subject;

import org.ceitba.api.support.SharedPostgres;
import org.ceitba.api.domain.Subject;
import org.ceitba.api.repository.SubjectRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class SubjectEndpointsIT {

    static final SharedPostgres.Database POSTGRES = SharedPostgres.newDatabase();

    @DynamicPropertySource
    static void datasourceProps(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired MockMvc mvc;
    @Autowired SubjectRepository subjectRepository;

    @BeforeEach
    void seed() {
        subjectRepository.deleteAll();
        subjectRepository.save(new Subject("93.12", "Algoritmos y Estructuras de Datos", 6));
    }

    @Test
    void getSubjectByIdReturnsTheOne() throws Exception {
        mvc.perform(get("/v1/subjects/93.12"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.id").value("93.12"))
            .andExpect(jsonPath("$.name").value("Algoritmos y Estructuras de Datos"))
            .andExpect(jsonPath("$.credits").value(6));
    }

    @Test
    void getUnknownSubjectReturns404() throws Exception {
        mvc.perform(get("/v1/subjects/99.99"))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.error").value("ResourceNotFound"));
    }
}
