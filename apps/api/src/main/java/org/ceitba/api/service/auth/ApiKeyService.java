package org.ceitba.api.service.auth;

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
import java.util.List;
import java.util.Optional;
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
        // API keys skip the allowlist, so a key would outlive disabling review login.
        if (reviewLogin.isReviewEmail(user.getEmail())) {
            throw new ReviewAccountRestrictedException("The review account cannot create API keys");
        }
        int days = (ttlDays != null && ttlDays > 0) ? ttlDays : DEFAULT_TTL_DAYS;
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        String rawKey = PREFIX + Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        var apiKey = new ApiKey(
            UUID.randomUUID(),
            user.getId(),
            name,
            sha256hex(rawKey),
            OffsetDateTime.now().plusDays(days)
        );
        apiKeyRepository.save(apiKey);
        return new ApiKeyCreatedResponse(apiKey.getId(), name, rawKey, apiKey.getExpiresAt());
    }

    @Transactional(readOnly = true)
    public List<ApiKeyResponse> listActive(User user) {
        return apiKeyRepository.findActiveByUserId(user.getId(), OffsetDateTime.now())
            .stream()
            .map(k -> new ApiKeyResponse(k.getId(), k.getName(),
                                         k.getCreatedAt(), k.getExpiresAt(), k.getLastUsedAt()))
            .toList();
    }

    @Transactional
    public boolean revoke(User user, UUID keyId) {
        return apiKeyRepository.deleteByIdAndUserId(keyId, user.getId()) > 0;
    }

    // Validates a raw key passed in X-Api-Key. Returns the owning User if valid and not expired.
    @Transactional
    public Optional<User> validate(String rawKey) {
        if (!rawKey.startsWith(PREFIX)) return Optional.empty();
        String hash = sha256hex(rawKey);
        return apiKeyRepository.findByKeyHash(hash)
            .filter(k -> !k.isExpired())
            .flatMap(k -> {
                k.markUsed();
                return userRepository.findById(k.getUserId());
            });
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
