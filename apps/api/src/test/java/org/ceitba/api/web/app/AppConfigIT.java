package org.ceitba.api.web.app;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
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
    "mobile-app.maintenance=true"
})
class AppConfigIT {

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
