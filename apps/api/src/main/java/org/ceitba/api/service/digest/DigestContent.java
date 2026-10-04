package org.ceitba.api.service.digest;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;

// Entity-free view of an issue's candidates (service/digest only builds them
// from entities inside its own transactions).
public final class DigestContent {

    private DigestContent() {}

    public record Org(String slug, String name) {}

    public record Article(String id, String title, String excerpt, String coverImage,
                          LocalDate publishedAt, Org organization) {}

    public record Event(String id, String title, LocalDate eventDate, LocalTime startTime,
                        LocalTime endTime, String location, Org organization) {}

    public record Candidates(DigestWeek week, List<Article> articles, List<Event> events) {}

    // One reader's digest. followedOrgs = null means "every org" (preview).
    public record Personal(List<Article> articles, List<Event> events, List<Org> followedOrgs) {
        public boolean isEmpty() { return articles.isEmpty() && events.isEmpty(); }
    }
}
