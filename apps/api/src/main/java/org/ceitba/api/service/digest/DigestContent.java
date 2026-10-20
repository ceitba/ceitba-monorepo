package org.ceitba.api.service.digest;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;

// Entity-free view of an issue's content (service/digest only builds it from
// entities inside its own transactions).
public final class DigestContent {

    private DigestContent() {}

    public record Org(String slug, String name) {}

    public record Article(String id, String title, String excerpt, String coverImage,
                          LocalDate publishedAt, Org organization) {}

    // signup: people can sign up (RSVP or an external form).
    public record Event(String id, String title, LocalDate eventDate, LocalTime startTime,
                        LocalTime endTime, String location, Org organization, boolean signup) {}

    // Every candidate of the week, before staff exclusions.
    public record Candidates(DigestWeek week, List<Article> articles, List<Event> events) {}

    // What every recipient gets: the candidates minus staff exclusions.
    public record Shared(List<Article> articles, List<Event> events) {
        public boolean isEmpty() { return articles.isEmpty() && events.isEmpty(); }
    }
}
