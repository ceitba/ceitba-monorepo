package org.ceitba.api.service.media;

import org.ceitba.api.common.exception.RateLimitExceededException;
import org.ceitba.api.common.exception.ValidationException;
import org.ceitba.api.config.RateLimitProperties;
import org.ceitba.api.service.crypto.ContentHmac;
import org.ceitba.api.service.ratelimit.UserRateLimiter;
import org.ceitba.api.web.media.dto.SignUploadRequest;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class MediaUploadServiceTest {

    private static final long MB = 1024L * 1024L;
    private static final UUID ALICE = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID BOB = UUID.fromString("22222222-2222-2222-2222-222222222222");

    // Records every signing input.
    private static final class RecordingStorage implements ObjectStorage {
        record Call(String key, String contentType, long length) {}
        final List<Call> calls = new ArrayList<>();

        @Override
        public PresignedUpload presignPut(String key, String contentType, long contentLength) {
            calls.add(new Call(key, contentType, contentLength));
            return new PresignedUpload("https://bucket.test/" + key + "?sig", Map.of("Content-Type", contentType),
                Instant.parse("2026-01-01T00:10:00Z"));
        }

        @Override
        public String publicUrl(String key) {
            return "https://media.test/" + key;
        }
    }

    private final RecordingStorage storage = new RecordingStorage();

    private MediaUploadService service(int attachmentCapacity) {
        var rate = new RateLimitProperties(true, false, null, null, Map.of(
            MediaUploadService.PROPOSAL_ATTACHMENT_RATE_RULE,
            new RateLimitProperties.UserRule(attachmentCapacity, Duration.ofHours(1))));
        return new MediaUploadService(storage, new UserRateLimiter(rate),
            ContentHmac.fromJwtSecret("dGVzdC1qd3Qtc2VjcmV0LWtleS0zMmJ5dGVzLWxvbmch"));
    }

    private static SignUploadRequest req(String type, long size) {
        return new SignUploadRequest("file", type, size);
    }

    @Test
    void staffImage_signsServerChosenKey() {
        var res = service(10).signStaffImage(new SignUploadRequest("../../evil.png", "Image/PNG", 2048));

        assertThat(res.key()).matches("media/[0-9a-f-]{36}\\.png");
        assertThat(res.method()).isEqualTo("PUT");
        assertThat(res.publicUrl()).isEqualTo("https://media.test/" + res.key());
        assertThat(res.uploadUrl()).startsWith("https://bucket.test/" + res.key());
        assertThat(storage.calls).containsExactly(new RecordingStorage.Call(res.key(), "image/png", 2048));
    }

    @Test
    void staffImage_rejectsPdfAndOversize() {
        var svc = service(10);
        assertThatThrownBy(() -> svc.signStaffImage(req("application/pdf", 10)))
            .isInstanceOf(ValidationException.class);
        assertThatThrownBy(() -> svc.signStaffImage(req("image/jpeg", 5 * MB + 1)))
            .isInstanceOf(ValidationException.class);
        assertThat(storage.calls).isEmpty();
    }

    @Test
    void proposalAttachment_limitsPerType() {
        var svc = service(10);
        svc.signProposalAttachment(ALICE, req("image/webp", 5 * MB));
        svc.signProposalAttachment(ALICE, req("application/pdf", 10 * MB));

        assertThatThrownBy(() -> svc.signProposalAttachment(ALICE, req("image/jpeg", 5 * MB + 1)))
            .isInstanceOf(ValidationException.class);
        assertThatThrownBy(() -> svc.signProposalAttachment(ALICE, req("application/pdf", 10 * MB + 1)))
            .isInstanceOf(ValidationException.class);
        assertThatThrownBy(() -> svc.signProposalAttachment(ALICE, req("image/gif", 10)))
            .isInstanceOf(ValidationException.class);
        assertThat(storage.calls).extracting(RecordingStorage.Call::contentType)
            .containsExactly("image/webp", "application/pdf");
    }

    @Test
    void proposalAttachment_keyIsBoundToItsUploaderWithoutRevealingOrLinkingThem() {
        var svc = service(10);
        var key = svc.signProposalAttachment(ALICE, req("application/pdf", 100)).key();

        assertThat(key).matches("proposals/[0-9a-f-]{36}-[0-9a-f]{16}\\.pdf");
        assertThat(key).doesNotContain(ALICE.toString()).doesNotContain(ALICE.toString().replace("-", ""));
        // Two uploads by the same user share no user-derived component, so
        // attachments on different proposals cannot be linked to one author.
        var again = svc.signProposalAttachment(ALICE, req("image/png", 100)).key();
        assertThat(tag(again)).isNotEqualTo(tag(key));
        assertThat(uuid(again)).isNotEqualTo(uuid(key));

        assertThat(svc.proposalAttachmentContentType(ALICE, key)).contains("application/pdf");
        assertThat(svc.proposalAttachmentContentType(ALICE, again)).contains("image/png");
        assertThat(svc.proposalAttachmentContentType(BOB, key)).isEmpty();
        assertThat(svc.proposalAttachmentContentType(ALICE, key + "x")).isEmpty();
        assertThat(svc.proposalAttachmentContentType(ALICE, "media/" + key)).isEmpty();
        assertThat(svc.proposalAttachmentContentType(ALICE, null)).isEmpty();
        // The tag is bound to the uuid: reusing it on another uuid, or
        // altering it, is rejected.
        var forged = "proposals/" + UUID.randomUUID() + "-" + tag(key) + ".pdf";
        assertThat(svc.proposalAttachmentContentType(ALICE, forged)).isEmpty();
        var flipped = key.substring(0, key.length() - 20) + (key.charAt(key.length() - 20) == '0' ? '1' : '0')
            + key.substring(key.length() - 19);
        assertThat(svc.proposalAttachmentContentType(ALICE, flipped)).isEmpty();
        // Legacy imported keys are never accepted from users.
        assertThat(svc.proposalAttachmentContentType(ALICE,
            "proposals/legacy/0f8e2a4c-1b3d-4e5f-8a7b-9c0d1e2f3a4b.png")).isEmpty();
    }

    private static String uuid(String key) {
        return key.substring("proposals/".length(), "proposals/".length() + 36);
    }

    private static String tag(String key) {
        int start = "proposals/".length() + 37;
        return key.substring(start, start + 16);
    }

    @Test
    void proposalAttachment_isRateLimitedPerUser() {
        var svc = service(2);
        svc.signProposalAttachment(ALICE, req("image/png", 1));
        svc.signProposalAttachment(ALICE, req("image/png", 1));
        assertThatThrownBy(() -> svc.signProposalAttachment(ALICE, req("image/png", 1)))
            .isInstanceOf(RateLimitExceededException.class);
        svc.signProposalAttachment(BOB, req("image/png", 1));
        // Invalid requests do not burn quota.
        assertThatThrownBy(() -> svc.signProposalAttachment(BOB, req("image/gif", 1)))
            .isInstanceOf(ValidationException.class);
        svc.signProposalAttachment(BOB, req("image/png", 1));
    }

    @Test
    void publicUrl_isTheBucketUrlOfTheKey() {
        var svc = service(10);
        assertThat(svc.publicUrl("proposals/x.png")).isEqualTo("https://media.test/proposals/x.png");
        assertThat(svc.publicUrl("proposals/legacy/x.jpg")).isEqualTo("https://media.test/proposals/legacy/x.jpg");
    }

    @Test
    void unconfiguredStorage_answersNotConfigured() {
        var unconfigured = new UnconfiguredObjectStorage();
        assertThat(unconfigured.publicUrl("k")).isNull();
        assertThatThrownBy(() -> unconfigured.presignPut("k", "image/png", 1))
            .isInstanceOf(org.ceitba.api.common.exception.FeatureNotConfiguredException.class);
    }
}
