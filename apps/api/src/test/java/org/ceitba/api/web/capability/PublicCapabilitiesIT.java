package org.ceitba.api.web.capability;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;

import static org.hamcrest.Matchers.empty;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// GET /v1/capabilities: anonymous visitors learn which features are on for everyone.
@SpringBootTest
@AutoConfigureMockMvc
class PublicCapabilitiesIT {

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;

    @AfterEach
    void clean() {
        jdbc.update("DELETE FROM public.capability_settings");
    }

    @Test
    void listsOnlyCapabilitiesEnabledForAllWithoutASession() throws Exception {
        jdbc.update("DELETE FROM public.capability_settings");
        mvc.perform(get("/v1/capabilities"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.enabledForAll", empty()));

        jdbc.update("""
            INSERT INTO public.capability_settings (capability, enabled_for_all) VALUES
              ('apuntes', true), ('resumen_semanal', false), ('gone', true)
            """);

        mvc.perform(get("/v1/capabilities"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.enabledForAll.length()").value(1))
            .andExpect(jsonPath("$.enabledForAll[0]").value("apuntes"));
    }
}
