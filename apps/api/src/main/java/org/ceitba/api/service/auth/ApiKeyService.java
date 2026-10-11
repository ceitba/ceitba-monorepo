package org.ceitba.api.service.auth;

import org.ceitba.api.common.exception.ValidationException;
import org.ceitba.api.config.ReviewLoginProperties;
import org.ceitba.api.domain.ApiKey;
import org.ceitba.api.domain.User;
import org.ceitba.api.repository.ApiKeyRepository;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.web.auth.dto.ApiKeyCreatedResponse;
import org.ceitba.api.web.auth.dto.ApiKeyResponse;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.OffsetDateTime;
import java.util.Base64;
import java.util.EnumSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

@Service
public class ApiKeyService {

    public static final String PREFIX = "ceitba_";
    private static final int DEFAULT_TTL_DAYS = 365;

    private final ApiKeyRepository apiKeyRepository;
    private final UserRepository userRepository;
    private final ReviewLoginProperties reviewLogin;
    private final SecureRandom random = new SecureRandom();

    public ApiKeyService(ApiKeyRepository apiKeyRepository, UserRepository userRepository,
                         ReviewLoginProperties reviewLogin) {
        this.apiKeyRepository = apiKeyRepository;
        this.userRepository   = userRepository;
        this.reviewLogin      = reviewLogin;
    }

    @Transactional
    public ApiKeyCreatedResponse create(User user, String name, Integer ttlDays) {
        return create(user, name, ttlDays, null);
    }

    // scopeKeys: subset of read/report/write/staff/keys; null → all (full power), [] → read only.
    // A request authenticated with a key that isn't full power (lacks any scope,
    // keys included) cannot create keys, so a key can never mint a more powerful one. Checked here, not by path in ApiKeyFilter,
    // so an encoded path (api%2Dkeys) can't skip it.
    @Transactional
    public ApiKeyCreatedResponse create(User user, String name, Integer ttlDays, List<String> scopeKeys) {
        if (ApiKeyCredential.current().filter(k -> !k.isFullPower()).isPresent()) {
            throw new InsufficientScopeException("Scoped API keys cannot create API keys");
        }
        // Keep the review account keyless: a key is a long-lived credential and
        // the account only exists for store review.
        if (reviewLogin.isReviewEmail(user.getEmail())) {
            throw new ReviewAccountRestrictedException("The review account cannot create API keys");
        }
        Set<ApiKeyScope> scopes = parseScopes(scopeKeys);
        int days = (ttlDays != null && ttlDays > 0) ? ttlDays : DEFAULT_TTL_DAYS;
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        String rawKey = PREFIX + Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        var apiKey = new ApiKey(
            UUID.randomUUID(),
            user.getId(),
            name,
            sha256hex(rawKey),
            OffsetDateTime.now().plusDays(days),
            ApiKeyScope.serialize(scopes)
        );
        apiKeyRepository.save(apiKey);
        return new ApiKeyCreatedResponse(apiKey.getId(), name, rawKey, apiKey.getExpiresAt(), ApiKeyScope.keys(scopes));
    }

    @Transactional(readOnly = true)
    public List<ApiKeyResponse> listActive(User user) {
        return apiKeyRepository.findActiveByUserId(user.getId(), OffsetDateTime.now())
            .stream()
            .map(k -> new ApiKeyResponse(k.getId(), k.getName(),
                                         k.getCreatedAt(), k.getExpiresAt(), k.getLastUsedAt(),
                                         ApiKeyScope.keys(ApiKeyScope.parse(k.getScopes()))))
            .toList();
    }

    // A key that isn't full power may only revoke itself (apps/mcp cleans up on logout).
    @Transactional
    public boolean revoke(User user, UUID keyId) {
        var caller = ApiKeyCredential.current();
        if (caller.isPresent() && !caller.get().isFullPower() && !keyId.equals(caller.get().keyId())) {
            throw new InsufficientScopeException("Scoped API keys can only revoke themselves");
        }
        return apiKeyRepository.deleteByIdAndUserId(keyId, user.getId()) > 0;
    }

    // A validated X-Api-Key: its id, owner and the scopes the key carries.
    public record ValidatedKey(UUID keyId, User user, Set<ApiKeyScope> scopes) {
        public boolean has(ApiKeyScope scope) { return scopes.contains(scope); }
        public boolean isFullPower()         { return scopes.containsAll(ApiKeyScope.ALL); }
    }

    // Validates a raw key passed in X-Api-Key. Returns the owner and scopes if valid and not expired.
    @Transactional
    public Optional<ValidatedKey> validate(String rawKey) {
        if (!rawKey.startsWith(PREFIX)) return Optional.empty();
        String hash = sha256hex(rawKey);
        return apiKeyRepository.findByKeyHash(hash)
            .filter(k -> !k.isExpired())
            .flatMap(k -> {
                k.markUsed();
                return userRepository.findById(k.getUserId())
                    .map(u -> new ValidatedKey(k.getId(), u, ApiKeyScope.parse(k.getScopes())));
            });
    }

    private static Set<ApiKeyScope> parseScopes(List<String> scopeKeys) {
        if (scopeKeys == null) return ApiKeyScope.normalize(null);
        var parsed = EnumSet.noneOf(ApiKeyScope.class);
        for (String k : scopeKeys) {
            try {
                parsed.add(ApiKeyScope.fromKey(k == null ? "" : k));
            } catch (IllegalArgumentException e) {
                throw new ValidationException("scopes", k, "must be one of read, report, write, staff, keys");
            }
        }
        return ApiKeyScope.normalize(parsed);
    }

    static String sha256hex(String input) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                .digest(input.getBytes(StandardCharsets.UTF_8));
            var sb = new StringBuilder(64);
            for (byte b : digest) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new RuntimeException(e);
        }
    }
}
