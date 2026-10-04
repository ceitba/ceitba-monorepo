package org.ceitba.api.web.digest.dto;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

// Request/response bodies of /v1/digests (docs/WEEKLY-DIGEST.md).
public final class DigestDtos {

    private DigestDtos() {}

    public record Counts(long pending, long sent, long failed) {
        public static final Counts ZERO = new Counts(0, 0, 0);
    }

    public record OrgRef(String slug, String name) {}

    public record Summary(UUID id, LocalDate weekStart, LocalDate weekEnd, String subject, String status,
                          OffsetDateTime autoSendAt, OffsetDateTime sentAt, OffsetDateTime createdAt,
                          Counts counts) {}

    public record ArticleItem(String id, String title, String excerpt, String coverImage, LocalDate publishedAt,
                              OrgRef organization, boolean excluded) {}

    public record EventItem(String id, String title, LocalDate eventDate, LocalTime startTime, LocalTime endTime,
                            String location, OrgRef organization, boolean excluded) {}

    // recipientEstimate: eligible recipients, only for a draft (null otherwise;
    // counts holds the real numbers once sending started).
    public record Detail(UUID id, LocalDate weekStart, LocalDate weekEnd, String subject, String intro,
                         String status, OffsetDateTime autoSendAt, OffsetDateTime sentAt, Counts counts,
                         Long recipientEstimate, List<ArticleItem> articles, List<EventItem> events) {}

    // autoSendAt (optional, ISO-8601 instant): must not be in the past.
    public record CreateRequest(@NotNull LocalDate weekStart, String autoSendAt) {}

    // Absent (or null) subject / excluded*Ids = unchanged. intro and
    // autoSendAt are JsonNodes so absent (unchanged) and explicit null (clear;
    // for autoSendAt: disable auto-send) can be told apart.
    public record PatchRequest(@Size(max = 200) String subject,
                               JsonNode intro,
                               @Size(max = 500) List<String> excludedArticleIds,
                               @Size(max = 500) List<String> excludedEventIds,
                               JsonNode autoSendAt) {}

    public record TestSendResponse(String sentTo) {}

    public record Subscription(@NotNull Boolean enabled) {}

    // ---- "¿Es así?" correction vote page (public, token-authenticated)

    public record Slot(String day, String from, String to) {}

    // Never carries the suggester or any voter. `myVote` is the token
    // holder's current vote (CONFIRM | REJECT | null); `open` = votes are
    // accepted (PENDING/APPLIED on a commission that has not ended).
    public record CorrectionVoteView(UUID correctionId, String subjectId, String subjectName,
                                     String commissionName, String status, boolean open,
                                     List<Slot> proposed, List<Slot> sga, int confirms, int rejects,
                                     String myVote, OffsetDateTime expiresAt) {}

    public record CorrectionVoteRequest(@NotNull @Size(max = 200) String token, @NotNull String vote) {}

    // previousVote: what the holder had voted before this request (null =
    // first vote; equal to the new one = nothing changed).
    public record CorrectionVoteResult(CorrectionVoteView correction, String previousVote) {}
}
