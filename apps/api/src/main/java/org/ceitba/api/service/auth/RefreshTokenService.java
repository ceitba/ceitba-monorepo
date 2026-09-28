package org.ceitba.api.service.auth;

import org.ceitba.api.config.AuthProperties;
import org.ceitba.api.domain.RefreshToken;
import org.ceitba.api.domain.User;
import org.ceitba.api.repository.RefreshTokenRepository;
import org.ceitba.api.repository.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.Base64;
import java.util.HexFormat;
import java.util.UUID;

// Rotating refresh tokens for the mobile app (table refresh_tokens, V17).
//
//   * Login starts a new family. Every successful refresh revokes the
//     presented token, points it at its successor (replaced_by) and issues
//     the successor in the same family with a fresh TTL (sliding expiry).
//   * Reuse detection: presenting a token that was already rotated means two
//     parties hold the same family (e.g. a stolen token). The whole family is
//     revoked so both are logged out.
//   * Grace window (auth.jwt.refresh-reuse-grace, default 60 s): if the
//     rotation response never reached the client (network drop, app killed),
//     the client retries with the token it still has. When that token was
//     rotated within the window and its successor has not been used yet, the
//     unused successor is revoked (pointed at the new one, so presenting it
//     later counts as reuse) and a new successor is issued instead of
//     revoking the family. Outside the window, or once the successor has been
//     used, reuse revokes the family as above.
//   * The allowlist (SessionAllowlist) is re-checked on every refresh; a user
//     removed from it (or the review account once review login is disabled)
//     loses the family on their next refresh.
//   * Rotation, reuse revocation, logout and logout-all all take a per-family
//     advisory lock (RefreshTokenRepository.lockFamily) first, so a family
//     revocation always sees the successor of a concurrent rotation.
//
// Clients must still serialize refreshes: two concurrent calls with the same
// token both succeed within the grace window, but only the later response's
// token stays valid; using the earlier one ends the session.
@Service
public class RefreshTokenService {

    private static final Logger log = LoggerFactory.getLogger(RefreshTokenService.class);
    private static final String INVALID = "Refresh token is invalid or expired";

    private final RefreshTokenRepository tokens;
    private final UserRepository users;
    private final AuthProperties auth;
    private final SessionAllowlist allowlist;
    private final Clock clock;
    private final SecureRandom random = new SecureRandom();

    public RefreshTokenService(RefreshTokenRepository tokens, UserRepository users,
                               AuthProperties auth, SessionAllowlist allowlist, Clock clock) {
        this.tokens    = tokens;
        this.users     = users;
        this.auth      = auth;
        this.allowlist = allowlist;
        this.clock  = clock;
    }

    @Transactional
    public IssuedRefreshToken issueNewFamily(UUID userId, String deviceName) {
        return issue(userId, UUID.randomUUID(), deviceName, OffsetDateTime.now(clock)).issued();
    }

    // The family revocations below must survive the exception that follows
    // them, hence noRollbackFor.
    @Transactional(noRollbackFor = {InvalidTokenException.class, LoginRejectedException.class})
    public Rotation rotate(String rawToken) {
        String tokenHash = hash(rawToken);
        var familyId = tokens.findFamilyIdByTokenHash(tokenHash)
            .orElseThrow(() -> new InvalidTokenException(INVALID));
        tokens.lockFamily(familyId);
        var current = tokens.findByTokenHashForUpdate(tokenHash)
            .orElseThrow(() -> new InvalidTokenException(INVALID));
        var now = OffsetDateTime.now(clock);

        RefreshToken unusedSuccessor = null;
        if (current.isRevoked()) {
            if (current.getReplacedBy() == null) {
                throw new InvalidTokenException(INVALID); // logged out
            }
            unusedSuccessor = retryableSuccessor(current, now);
            if (unusedSuccessor == null) {
                log.warn("Refresh token reuse detected for user {} (family {}); revoking family",
                    current.getUserId(), current.getFamilyId());
                tokens.revokeFamily(current.getFamilyId(), now);
                throw new InvalidTokenException(INVALID);
            }
        }
        if (!current.getExpiresAt().isAfter(now)) {
            throw new InvalidTokenException(INVALID);
        }

        var user = users.findById(current.getUserId())
            .orElseThrow(() -> new InvalidTokenException(INVALID));
        if (!allowlist.admits(user.getEmail())) {
            tokens.revokeFamily(current.getFamilyId(), now);
            throw new LoginRejectedException(LoginRejectedException.Reason.NOT_ALLOWLISTED);
        }

        var next = issue(user.getId(), current.getFamilyId(), current.getDeviceName(), now);
        if (unusedSuccessor != null) {
            log.info("Refresh token retried within grace window for user {} (family {}); replacing unused successor",
                current.getUserId(), current.getFamilyId());
            unusedSuccessor.rotateTo(next.entity().getId(), now);
            current.repointTo(next.entity().getId());
        } else {
            current.rotateTo(next.entity().getId(), now);
        }
        return new Rotation(user, next.issued());
    }

    // The successor of a rotated token, if the rotation happened within the
    // grace window and the successor is still live (never used, not expired);
    // null otherwise. The successor row is locked so a concurrent refresh with
    // it serializes against this retry.
    private RefreshToken retryableSuccessor(RefreshToken rotated, OffsetDateTime now) {
        var grace = auth.jwt().refreshReuseGrace();
        if (grace.isZero() || rotated.getRevokedAt().plus(grace).isBefore(now)) return null;
        return tokens.findByIdForUpdate(rotated.getReplacedBy())
            .filter(s -> !s.isRevoked() && s.getExpiresAt().isAfter(now))
            .orElse(null);
    }

    // Logout: revokes the family the token belongs to. Unknown tokens are
    // ignored so logout stays idempotent and leaks nothing.
    @Transactional
    public void revokeFamilyOf(String rawToken) {
        tokens.findFamilyIdByTokenHash(hash(rawToken)).ifPresent(familyId -> {
            tokens.lockFamily(familyId);
            tokens.revokeFamily(familyId, OffsetDateTime.now(clock));
        });
    }

    // Logout-all: waits for in-flight rotations of every live family so their
    // successors are committed (and then revoked) rather than missed. A login
    // racing this call starts a brand-new family, which is a new session.
    @Transactional
    public void revokeAllForUser(UUID userId) {
        tokens.findLiveFamilyIds(userId).forEach(tokens::lockFamily);
        tokens.revokeAllForUser(userId, OffsetDateTime.now(clock));
    }

    private Created issue(UUID userId, UUID familyId, String deviceName, OffsetDateTime now) {
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        String raw = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        var expiresAt = now.plus(auth.jwt().refreshTtl());
        var entity = tokens.save(new RefreshToken(
            UUID.randomUUID(), userId, familyId, hash(raw), truncate(deviceName), expiresAt));
        return new Created(entity, new IssuedRefreshToken(raw, expiresAt.toInstant()));
    }

    private static String truncate(String deviceName) {
        if (deviceName == null || deviceName.isBlank()) return null;
        String trimmed = deviceName.trim();
        return trimmed.length() > 120 ? trimmed.substring(0, 120) : trimmed;
    }

    static String hash(String raw) {
        if (raw == null) return "";
        try {
            var digest = MessageDigest.getInstance("SHA-256").digest(raw.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 not available", e);
        }
    }

    public record IssuedRefreshToken(String token, Instant expiresAt) {}

    public record Rotation(User user, IssuedRefreshToken refreshToken) {}

    private record Created(RefreshToken entity, IssuedRefreshToken issued) {}
}
