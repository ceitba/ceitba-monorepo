package org.ceitba.api.web.wiki;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

import java.util.UUID;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Pinned subjects of /apuntes, on top of the subject bookmarks: the
// caller's list (most recent first, with published file count and wiki
// flag), logged-in only, and the 30-pin cap.
@SpringBootTest
@AutoConfigureMockMvc
class PinnedSubjectsIT {

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;

    static RequestPostProcessor as(String email) {
        return jwt().jwt(t -> t.claim("email", email).claim("name", email));
    }

    @BeforeEach
    void seed() {
        jdbc.execute("TRUNCATE wiki.subject_bookmarks, wiki.kb_page, wiki.drive_file, wiki.drive_source, "
            + "public.\"user\", public.subject CASCADE");
        for (int i = 10; i < 45; i++) {
            jdbc.update("INSERT INTO public.subject (id, name, credits, updated_at) VALUES (?, ?, 3, now())",
                "90." + i, "Materia " + i);
        }
        // 90.10: one published file and a published wiki page.
        var owner = UUID.randomUUID();
        jdbc.update("INSERT INTO public.\"user\" (id, email, name, created_at, updated_at) "
            + "VALUES (?, 'autora@itba.edu.ar', 'Autora', now(), now())", owner);
        var source = UUID.randomUUID();
        jdbc.update("INSERT INTO wiki.drive_source (id, user_id, root_folder_id, root_name, status, consent_version, "
            + "consented_at, approved_at) VALUES (?, ?, 'root', 'Apuntes', 'ACTIVE', '2026-10', now(), now())",
            source, owner);
        jdbc.update("INSERT INTO wiki.drive_file (id, source_id, drive_id, name, mime_type, kind, owned_by_sharer, "
            + "effective_subject_id, publication) VALUES (?, ?, 'd1', 'a.pdf', 'application/pdf', 'PDF', true, "
            + "'90.10', 'PUBLISHED')", UUID.randomUUID(), source);
        jdbc.update("INSERT INTO wiki.kb_page (subject_id, slug, type, title, summary, markdown, generator, "
            + "generated_at) VALUES ('90.10', 'index', 'INDEX', 'Materia 10', 's', 'm', 'manual', now())");
    }

    @Test
    void listCapAndAccess() throws Exception {
        var me = as("alumno@itba.edu.ar");
        mvc.perform(get("/v1/wiki/bookmarks")).andExpect(status().isUnauthorized());
        mvc.perform(get("/v1/wiki/bookmarks").with(me)).andExpect(status().isOk()).andExpect(jsonPath("$").isEmpty());

        mvc.perform(put("/v1/wiki/bookmarks/90.10").with(me)).andExpect(status().isOk());
        jdbc.update("UPDATE wiki.subject_bookmarks SET updated_at = now() - interval '1 hour'");
        mvc.perform(put("/v1/wiki/bookmarks/90.11").with(me)).andExpect(status().isOk());
        // Someone else's pins are not mine.
        mvc.perform(put("/v1/wiki/bookmarks/90.12").with(as("otro@itba.edu.ar"))).andExpect(status().isOk());

        mvc.perform(get("/v1/wiki/bookmarks").with(me))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(2))
            .andExpect(jsonPath("$[0].subjectId").value("90.11"))
            .andExpect(jsonPath("$[0].subjectName").value("Materia 11"))
            .andExpect(jsonPath("$[0].fileCount").value(0))
            .andExpect(jsonPath("$[0].hasWiki").value(false))
            .andExpect(jsonPath("$[0].pinnedAt").exists())
            .andExpect(jsonPath("$[1].subjectId").value("90.10"))
            .andExpect(jsonPath("$[1].fileCount").value(1))
            .andExpect(jsonPath("$[1].hasWiki").value(true));

        // The per-subject state stays public.
        mvc.perform(get("/v1/wiki/bookmarks/90.10")).andExpect(status().isOk())
            .andExpect(jsonPath("$.count").value(1));

        // At most 30 pins; re-pinning an existing one is still fine.
        for (int i = 13; i < 41; i++) {
            mvc.perform(put("/v1/wiki/bookmarks/90." + i).with(me)).andExpect(status().isOk());
        }
        mvc.perform(put("/v1/wiki/bookmarks/90.41").with(me))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error").value("BOOKMARK_LIMIT"));
        mvc.perform(put("/v1/wiki/bookmarks/90.10").with(me)).andExpect(status().isOk());
        mvc.perform(delete("/v1/wiki/bookmarks/90.10").with(me)).andExpect(status().isNoContent());
        mvc.perform(put("/v1/wiki/bookmarks/90.41").with(me)).andExpect(status().isOk());
    }
}
