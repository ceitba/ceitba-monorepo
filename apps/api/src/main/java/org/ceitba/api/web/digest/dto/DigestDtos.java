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

    // resumeAt: while `sending` and the sending account is paused (quota used
    // up, Gmail's daily limit, transport backoff), when it resumes.
    // estimatedFinishAt: while `sending`, when the last email should go out
    // (rolling quota included; approximate). openRate/clickRate: unique
    // opens/clicks over delivered (sent) emails, 0..1; null with nothing
    // delivered.
    public record Summary(UUID id, LocalDate weekStart, LocalDate weekEnd, String subject, String status,
                          OffsetDateTime autoSendAt, OffsetDateTime sentAt, OffsetDateTime createdAt,
                          Counts counts, OffsetDateTime resumeAt, OffsetDateTime estimatedFinishAt,
                          Double openRate, Double clickRate) {}

    public record ArticleItem(String id, String title, String excerpt, String coverImage, LocalDate publishedAt,
                              OrgRef organization, boolean excluded) {}

    public record EventItem(String id, String title, LocalDate eventDate, LocalTime startTime, LocalTime endTime,
                            String location, OrgRef organization, boolean excluded) {}

    public record Detail(UUID id, LocalDate weekStart, LocalDate weekEnd, String subject, String intro,
                         String status, OffsetDateTime autoSendAt, OffsetDateTime sentAt, Counts counts,
                         long recipientEstimate, List<ArticleItem> articles, List<EventItem> events,
                         OffsetDateTime resumeAt, OffsetDateTime estimatedFinishAt) {}

    // GET /v1/digests/quota: the sending account's rolling 24h quota.
    // pausedUntil/pauseReason (quota | transport): an active pause.
    // nextCapacityAt: with nothing remaining, when the next email can go.
    public record Quota(String account, int limit, long usedLast24h, long remaining,
                        OffsetDateTime pausedUntil, String pauseReason, OffsetDateTime nextCapacityAt) {}

    // GET /v1/digests/{id}/stats: aggregate engagement only, never per person.
    // Rates are over delivered emails (null with none); flagged events
    // (scanners, bots, within seconds of sending) are excluded.
    public record Stats(long delivered, long uniqueOpens, Double openRate, long uniqueClicks, Double clickRate,
                        List<LinkClicks> clicksByLink, List<HourCount> opensByHour) {}

    // url = the link without per-reader tokens.
    public record LinkClicks(String label, String url, long uniqueClicks, long totalClicks) {}

    // hour = start of the hour (ART offset); count = first opens in it.
    public record HourCount(OffsetDateTime hour, long count) {}

    public record CreateRequest(@NotNull LocalDate weekStart) {}

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
