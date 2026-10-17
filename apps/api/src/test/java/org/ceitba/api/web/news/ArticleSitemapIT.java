package org.ceitba.api.web.news;

import org.ceitba.api.domain.news.Article;
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
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// /sitemap.xml for Google: Caddy rewrites it to this endpoint.
@SpringBootTest
@AutoConfigureMockMvc
class ArticleSitemapIT {

    @Autowired MockMvc mvc;
    @Autowired ArticleRepository articleRepo;
    @Autowired OrganizationRepository orgRepo;

    @BeforeEach
    void seed() {
        articleRepo.deleteAll();
        orgRepo.deleteAll();
        var pub = new Article("a1", "Publicado", "excerpt", List.of("p"), "tech", List.of("Ian"));
        pub.setPublishedAt(LocalDate.of(2026, 10, 10));
        pub.setStatus("published");
        articleRepo.save(pub);
        for (var status : List.of("draft", "pending_review")) {
            var hidden = new Article("h-" + status, "Hidden", "excerpt", List.of("p"), "tech", List.of("A"));
            hidden.setStatus(status);
            articleRepo.save(hidden);
        }
    }

    @Test
    void listsOnlyPublishedArticlesWithoutASession() throws Exception {
        mvc.perform(get("/v1/articles/sitemap.xml"))
            .andExpect(status().isOk())
            // Served by the sitemap handler, not ArticleController's GET /{id}.
            .andExpect(content().contentTypeCompatibleWith("application/xml"))
            .andExpect(header().string("Cache-Control", containsString("public")))
            .andExpect(content().string(containsString("<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">")))
            .andExpect(content().string(containsString("<loc>https://ceitba.org.ar/newsletter</loc>")))
            .andExpect(content().string(containsString("<loc>https://ceitba.org.ar/newsletter/articles/a1</loc><lastmod>")))
            .andExpect(content().string(not(containsString("h-draft"))))
            .andExpect(content().string(not(containsString("h-pending_review"))));
    }
}
