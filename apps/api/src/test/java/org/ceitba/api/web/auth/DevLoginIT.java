package org.ceitba.api.web.auth;

import jakarta.servlet.http.Cookie;
import org.ceitba.api.repository.CeitbaStaffRepository;
import org.ceitba.api.repository.UserRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import java.time.OffsetDateTime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// POST /v1/auth/dev-login with the dev profile and the flag on: sets the
// session cookie, JIT-provisions the user and, with staff=true, an active
// ceitba_staff row. DevLoginDisabledIT covers the 404 otherwise.
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("dev")
@TestPropertySource(properties = {
    "auth.dev-login.enabled=true"
})
class DevLoginIT {

    @Autowired MockMvc mvc;
    @Autowired UserRepository users;
    @Autowired CeitbaStaffRepository staff;

    @Test
    void signsInWithTheSessionCookieAndOptionallyAsStaff() throws Exception {
        var res = mvc.perform(post("/v1/auth/dev-login").contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"Alumno1@itba.edu.ar\",\"name\":\"Alumno Uno\",\"staff\":false}"))
            .andExpect(status().isNoContent())
            .andReturn().getResponse();
        Cookie session = res.getCookie("ceitba_session");
        assertThat(session).isNotNull();
        assertThat(session.isHttpOnly()).isTrue();

        mvc.perform(get("/v1/auth/me").cookie(session))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.email").value("alumno1@itba.edu.ar"));
        var user = users.findByEmail("alumno1@itba.edu.ar").orElseThrow();
        assertThat(staff.isActiveStaff(user.getId(), OffsetDateTime.now())).isFalse();

        var asStaff = mvc.perform(post("/v1/auth/dev-login").contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"staff1@itba.edu.ar\",\"staff\":true}"))
            .andExpect(status().isNoContent())
            .andReturn().getResponse().getCookie("ceitba_session");
        var staffUser = users.findByEmail("staff1@itba.edu.ar").orElseThrow();
        assertThat(staff.isActiveStaff(staffUser.getId(), OffsetDateTime.now())).isTrue();
        mvc.perform(get("/v1/staff/drive/unclaimed").cookie(asStaff)).andExpect(status().isOk());
        // Idempotent.
        mvc.perform(post("/v1/auth/dev-login").contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"staff1@itba.edu.ar\",\"staff\":true}"))
            .andExpect(status().isNoContent());

        mvc.perform(post("/v1/auth/dev-login").contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"someone@gmail.com\"}"))
            .andExpect(status().isBadRequest());
    }
}
