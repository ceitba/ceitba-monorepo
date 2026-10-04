package org.ceitba.api.web.app;

import org.ceitba.api.support.SharedPostgres;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = {
    "mobile-app.min-version=1.2.0",
    "mobile-app.latest-version=1.4.1",
    "mobile-app.maintenance=true",
    "itba.api.use-fake=true"
})
class AppConfigIT {

    static final SharedPostgres.Database POSTGRES = SharedPostgres.newDatabase();

    @DynamicPropertySource
    static void datasourceProps(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired MockMvc mvc;

    @Test
    void appConfigIsPublicAndPropertiesBacked() throws Exception {
        mvc.perform(get("/v1/app/config"))
            .andExpect(status().isOk())
            .andExpect(header().string("Cache-Control", "max-age=60, public"))
            .andExpect(jsonPath("$.minVersion").value("1.2.0"))
            .andExpect(jsonPath("$.latestVersion").value("1.4.1"))
            .andExpect(jsonPath("$.maintenance").value(true));
    }
}
