package org.ceitba.api.service.auth;

import java.util.Arrays;
import java.util.Collection;
import java.util.EnumSet;
import java.util.Locale;
import java.util.Set;
import java.util.stream.Collectors;

// Scopes a user API key can carry (api_keys.scopes, V54). A key never grants
// more than its owner has; scopes only take power away:
//   READ   safe methods only (GET/HEAD); always present on every key
//   WRITE  non-safe methods (POST/PUT/PATCH/DELETE)
//   STAFF  keep ROLE_STAFF / ROLE_MODERATOR when the owner holds them
public enum ApiKeyScope {
    READ, WRITE, STAFF;

    public static final Set<ApiKeyScope> ALL = EnumSet.allOf(ApiKeyScope.class);

    public String key() {
        return name().toLowerCase(Locale.ROOT);
    }

    public static ApiKeyScope fromKey(String key) {
        for (var s : values()) {
            if (s.key().equalsIgnoreCase(key.trim())) return s;
        }
        throw new IllegalArgumentException("Unknown API key scope: " + key);
    }

    // null/empty means "full power" (the pre-V54 behaviour); READ is implied.
    public static Set<ApiKeyScope> normalize(Collection<ApiKeyScope> requested) {
        if (requested == null || requested.isEmpty()) return EnumSet.copyOf(ALL);
        var set = EnumSet.copyOf(requested);
        set.add(READ);
        return set;
    }

    public static String serialize(Set<ApiKeyScope> scopes) {
        return scopes.stream().sorted().map(ApiKeyScope::key).collect(Collectors.joining(","));
    }

    public static Set<ApiKeyScope> parse(String csv) {
        if (csv == null || csv.isBlank()) return EnumSet.copyOf(ALL);
        var set = EnumSet.noneOf(ApiKeyScope.class);
        Arrays.stream(csv.split(",")).filter(s -> !s.isBlank()).map(ApiKeyScope::fromKey).forEach(set::add);
        set.add(READ);
        return set;
    }
}
