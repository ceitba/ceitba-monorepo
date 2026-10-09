package org.ceitba.api.web.sync;

import org.ceitba.api.support.SharedPostgres;
import org.ceitba.api.web.auth.ApiKeyFilter;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {
    "auth.sync-api-key=test-sync-key",
    "itba.api.use-fake=true"
})
@AutoConfigureMockMvc
class DataSyncControllerIT {

    static final SharedPostgres.Database POSTGRES = SharedPostgres.newDatabase();

    @DynamicPropertySource
    static void datasourceProps(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired MockMvc mvc;

    // The period is stored on every synced commission (term_period), so a
    // value ITBA doesn't use is rejected before anything is fetched.
    @Test
    void rejectsAnUnknownPeriod() throws Exception {
        mvc.perform(post("/v1/sync/commissions")
                .param("year", "2026")
                .param("period", "SegundoCuatrimestre")
                .header(ApiKeyFilter.HEADER, "test-sync-key"))
            .andExpect(status().isBadRequest());
    }
}
