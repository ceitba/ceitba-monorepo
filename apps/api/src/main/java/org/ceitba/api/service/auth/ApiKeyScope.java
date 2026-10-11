package org.ceitba.api.service.auth;

import java.util.Arrays;
import java.util.Collection;
import java.util.EnumSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

// Scopes a user API key can carry (api_keys.scopes, V62). A key never grants
// more than its owner has; scopes only take power away:
//   READ    safe methods only (GET/HEAD); always present on every key
//   REPORT  reporting wiki pages and Apuntes files (ApiKeyFilter.REPORT_PATHS),
//           the only writes a student's MCP key may make; implied by WRITE
//   WRITE   non-safe methods (POST/PUT/PATCH/DELETE)
//   STAFF   keep ROLE_STAFF / ROLE_MODERATOR when the owner holds them
//   KEYS    create API keys and revoke other keys (ApiKeyService). Only a key
//           holding every scope is "full power" and may manage keys, so a
//           key can never mint a stronger one. apps/mcp never asks for it, so
//           even a staff member's MCP key (read, report, staff, write) can't.
public enum ApiKeyScope {
    READ, REPORT, WRITE, STAFF, KEYS;

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

    // null means "full power" (the pre-V62 behaviour). Any list, even an empty
    // one, is taken literally; READ is always implied, so [] is a read-only key.
    public static Set<ApiKeyScope> normalize(Collection<ApiKeyScope> requested) {
        if (requested == null) return EnumSet.copyOf(ALL);
        var set = EnumSet.of(READ);
        set.addAll(requested);
        return implied(set);
    }

    // READ is always there and WRITE covers REPORT.
    private static Set<ApiKeyScope> implied(EnumSet<ApiKeyScope> set) {
        set.add(READ);
        if (set.contains(WRITE)) set.add(REPORT);
        return set;
    }

    public static String serialize(Set<ApiKeyScope> scopes) {
        return String.join(",", keys(scopes));
    }

    // Sorted lowercase names, as the API returns them.
    public static List<String> keys(Set<ApiKeyScope> scopes) {
        return scopes.stream().sorted().map(ApiKeyScope::key).toList();
    }

    public static Set<ApiKeyScope> parse(String csv) {
        if (csv == null || csv.isBlank()) return EnumSet.copyOf(ALL);
        var set = EnumSet.noneOf(ApiKeyScope.class);
        Arrays.stream(csv.split(",")).filter(s -> !s.isBlank()).map(ApiKeyScope::fromKey).forEach(set::add);
        return implied(set);
    }
}
