package org.ceitba.api.service.media;

import org.ceitba.api.common.exception.ValidationException;
import org.ceitba.api.service.crypto.ContentHmac;
import org.ceitba.api.service.ratelimit.UserRateLimiter;
import org.ceitba.api.web.media.dto.SignUploadRequest;
import org.ceitba.api.web.media.dto.SignUploadResponse;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;

// Validates upload requests and signs direct-to-bucket PUTs.
//
// Keys are chosen server-side, never from the client's filename:
//   media/{uuid}.{ext}                STAFF CMS images
//   proposals/{uuid}-{tag}.{ext}      proposal attachments
// {tag} is the first 16 hex chars of HMAC-SHA256(k, userId ":" uuid), k a
// ContentHmac-derived key. Attachment URLs are public and proposals are
// pseudonymous (a per-proposal alias), so a key must reveal neither who
// uploaded it nor that two attachments on different proposals share an
// uploader: every key has a fresh uuid and therefore an unrelated tag. The
// tag still binds the key to its uploader, which is what lets
// POST /v1/proposals accept only keys the author signed (it recomputes the
// tag for the calling user).
@Service
public class MediaUploadService {

    public static final String PROPOSAL_ATTACHMENT_RATE_RULE = "proposal-attachments";
    public static final String ORG_IMAGE_RATE_RULE = "org-images";

    static final long MB = 1024L * 1024L;

    // content type -> (extension, max bytes)
    private record Allowed(String ext, long maxBytes) {}

    private static final Map<String, Allowed> STAFF_IMAGE_TYPES = Map.of(
        "image/jpeg", new Allowed("jpg", 5 * MB),
        "image/png",  new Allowed("png", 5 * MB),
        "image/webp", new Allowed("webp", 5 * MB));

    private static final Map<String, Allowed> PROPOSAL_TYPES = Map.of(
        "image/jpeg",      new Allowed("jpg", 5 * MB),
        "image/png",       new Allowed("png", 5 * MB),
        "image/webp",      new Allowed("webp", 5 * MB),
        "application/pdf", new Allowed("pdf", 10 * MB));

    private static final Map<String, String> PROPOSAL_EXT_TO_TYPE = Map.of(
        "jpg", "image/jpeg", "png", "image/png", "webp", "image/webp", "pdf", "application/pdf");

    private static final Pattern PROPOSAL_KEY = Pattern.compile(
        "^proposals/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-([0-9a-f]{16})\\.(jpg|png|webp|pdf)$");

    private final ObjectStorage storage;
    private final UserRateLimiter rateLimiter;
    private final ContentHmac hmac;

    public MediaUploadService(ObjectStorage storage, UserRateLimiter rateLimiter, ContentHmac hmac) {
        this.storage = storage;
        this.rateLimiter = rateLimiter;
        this.hmac = hmac;
    }

    public SignUploadResponse signStaffImage(SignUploadRequest req) {
        var contentType = normalize(req.contentType());
        var allowed = check(STAFF_IMAGE_TYPES, contentType, req.sizeBytes());
        return sign("media/" + UUID.randomUUID() + "." + allowed.ext(), contentType, req.sizeBytes());
    }

    // Org members' images (docs/ORGANIZATIONS.md): same types and sizes as
    // STAFF images, keyed under the org so the bucket shows whose they are.
    public SignUploadResponse signOrgImage(String orgSlug, UUID userId, SignUploadRequest req) {
        var contentType = normalize(req.contentType());
        var allowed = check(STAFF_IMAGE_TYPES, contentType, req.sizeBytes());
        rateLimiter.consume(ORG_IMAGE_RATE_RULE, userId);
        return sign("orgs/" + orgSlug + "/" + UUID.randomUUID() + "." + allowed.ext(), contentType, req.sizeBytes());
    }

    public SignUploadResponse signProposalAttachment(UUID userId, SignUploadRequest req) {
        var contentType = normalize(req.contentType());
        var allowed = check(PROPOSAL_TYPES, contentType, req.sizeBytes());
        rateLimiter.consume(PROPOSAL_ATTACHMENT_RATE_RULE, userId);
        var id = UUID.randomUUID().toString();
        var key = "proposals/" + id + "-" + tagOf(userId, id) + "." + allowed.ext();
        return sign(key, contentType, req.sizeBytes());
    }

    // Content type of a proposal attachment key signed for `userId`, or empty
    // if the key is malformed or belongs to someone else.
    public Optional<String> proposalAttachmentContentType(UUID userId, String key) {
        if (key == null) return Optional.empty();
        var m = PROPOSAL_KEY.matcher(key);
        if (!m.matches()) return Optional.empty();
        byte[] expected = tagOf(userId, m.group(1)).getBytes(StandardCharsets.US_ASCII);
        if (!MessageDigest.isEqual(expected, m.group(2).getBytes(StandardCharsets.US_ASCII))) return Optional.empty();
        return Optional.of(PROPOSAL_EXT_TO_TYPE.get(m.group(3)));
    }

    // Attachments imported from the legacy Firestore app live in the same
    // bucket under proposals/legacy/ (ProposalFirestoreImporter).
    public String publicUrl(String key) {
        return storage.publicUrl(key);
    }

    String tagOf(UUID userId, String keyUuid) {
        byte[] digest = hmac.sign(ContentHmac.PROPOSAL_ATTACHMENT_KEYS, userId + ":" + keyUuid);
        return HexFormat.of().formatHex(digest, 0, 8);
    }

    private SignUploadResponse sign(String key, String contentType, long sizeBytes) {
        var presigned = storage.presignPut(key, contentType, sizeBytes);
        return new SignUploadResponse(presigned.uploadUrl(), storage.publicUrl(key), key, "PUT",
            presigned.headers(), presigned.expiresAt());
    }

    private static Allowed check(Map<String, Allowed> allowedTypes, String contentType, long sizeBytes) {
        var allowed = allowedTypes.get(contentType);
        if (allowed == null) {
            throw new ValidationException("contentType", contentType,
                "unsupported content type. Allowed: " + String.join(", ", allowedTypes.keySet().stream().sorted().toList()));
        }
        if (sizeBytes > allowed.maxBytes()) {
            throw new ValidationException("sizeBytes", sizeBytes,
                "file too large. Maximum size for " + contentType + " is " + (allowed.maxBytes() / MB) + " MB");
        }
        return allowed;
    }

    // "Image/PNG; charset=x" -> "image/png"
    private static String normalize(String contentType) {
        int semi = contentType.indexOf(';');
        return (semi >= 0 ? contentType.substring(0, semi) : contentType).trim().toLowerCase(Locale.ROOT);
    }
}
