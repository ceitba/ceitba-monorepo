package org.ceitba.api.web.news;

import org.ceitba.api.domain.news.Article;
import org.ceitba.api.domain.news.Organization;
import org.ceitba.api.repository.news.ArticleRepository;
import org.ceitba.api.repository.news.OrganizationRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

import java.time.LocalDate;
import java.util.List;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Link previews (WhatsApp & co.): Caddy routes their crawlers here.
@SpringBootTest
@AutoConfigureMockMvc
class ArticleLinkPreviewIT {

    @Autowired MockMvc mvc;
    @Autowired ArticleRepository articleRepo;
    @Autowired OrganizationRepository orgRepo;

    @BeforeEach
    void seed() {
        articleRepo.deleteAll();
        orgRepo.deleteAll();
        var org = orgRepo.save(new Organization("ceitba", "CEITBA", "Centro de Estudiantes"));

        var pub = new Article("a1", "Apuntes \"CEITBA\" <nuevo>", "", List.of(
            "Casi todos estudiamos con el **resumen** de [alguien](https://x.org).",
            "![image](https://ceitba.org.ar/ceitba-media/m/foto.jpg)"), "Académico", List.of("Ian"));
        pub.setOrganization(org);
        pub.setPublishedAt(LocalDate.of(2026, 10, 10));
        pub.setStatus("published");
        articleRepo.save(pub);

        var draft = new Article("a2", "Draft", "excerpt", List.of("p"), "tech", List.of("A"));
        draft.setStatus("draft");
        articleRepo.save(draft);
    }

    @Test
    void publishedArticleHasOpenGraphTagsWithoutASession() throws Exception {
        mvc.perform(get("/v1/articles/a1/preview").header("User-Agent", "WhatsApp/2.23.20.0"))
            .andExpect(status().isOk())
            .andExpect(content().contentTypeCompatibleWith("text/html"))
            // Escaped title; description from the first paragraph without its markdown.
            .andExpect(content().string(containsString(
                "<meta property=\"og:title\" content=\"Apuntes &quot;CEITBA&quot; &lt;nuevo&gt;\">")))
            .andExpect(content().string(containsString(
                "<meta property=\"og:description\" content=\"Casi todos estudiamos con el resumen de alguien.\">")))
            .andExpect(content().string(containsString(
                "<meta property=\"og:url\" content=\"https://ceitba.org.ar/newsletter/articles/a1\">")))
            // No cover image: the first image in the body.
            .andExpect(content().string(containsString(
                "<meta property=\"og:image\" content=\"https://ceitba.org.ar/ceitba-media/m/foto.jpg\">")))
            .andExpect(content().string(containsString("content=\"CEITBA · ITBA News\"")))
            .andExpect(content().string(not(containsString("<nuevo>"))));
    }

    @Test
    void draftsAndUnknownArticlesAre404() throws Exception {
        mvc.perform(get("/v1/articles/a2/preview").accept("text/html")).andExpect(status().isNotFound());
        mvc.perform(get("/v1/articles/nope/preview").accept("text/html")).andExpect(status().isNotFound());
    }
}
