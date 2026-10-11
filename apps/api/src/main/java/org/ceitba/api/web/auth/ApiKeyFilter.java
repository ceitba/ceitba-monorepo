package org.ceitba.api.web.auth;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.ceitba.api.config.AuthProperties;
import org.ceitba.api.repository.CeitbaModeratorRepository;
import org.ceitba.api.repository.CeitbaStaffRepository;
import org.ceitba.api.service.auth.ApiKeyScope;
import org.ceitba.api.service.auth.ApiKeyService;
import org.ceitba.api.web.error.ErrorResponse;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.AuthorityUtils;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Set;

// Processes the X-Api-Key header before the JWT resource-server filter runs.
//
//   ceitba_* keys  →  user API key: looked up by SHA-256 hash in the DB;
//                     grants ROLE_USER (+ ROLE_STAFF and ROLE_MODERATOR if an
//                     active staff row exists, + ROLE_MODERATOR for an active
//                     moderator grant), same as StaffAwareJwtAuthenticationConverter,
//                     narrowed by the key's scopes (ApiKeyScope, V62):
//                       - no "staff" scope → ROLE_STAFF / ROLE_MODERATOR are withheld
//                       - no "write" scope → non-safe methods answer 403 INSUFFICIENT_SCOPE,
//                         except the report endpoints (REPORT_PATHS) for a "report" key
//                       - a key that isn't full power (every scope, "keys" included) cannot
//                         create API keys or revoke other keys (ApiKeyService, via
//                         ApiKeyCredential); any key may revoke itself, even a read-only one
//                     Each scope is also exposed as a SCOPE_<name> authority, and the
//                     ValidatedKey is the authentication's details (ApiKeyCredential).
//                     Path rules here only ever exempt an exact path, so an
//                     encoded or odd path can only be denied, never let through.
//                     The owner's email must still pass the session allowlist
//                     (enforced in SecurityConfig for User principals).
//   anything else  →  sync job static key: compared to auth.sync-api-key;
//                     grants ROLE_SYNC.
public class ApiKeyFilter extends OncePerRequestFilter {

    public static final String HEADER = "X-Api-Key";
    public static final String INSUFFICIENT_SCOPE = "INSUFFICIENT_SCOPE";

    // Non-safe methods that are read-style queries and stay open to read-only keys.
    private static final Set<String> READ_STYLE_POSTS = Set.of("/v1/classrooms/conflicts");
    private static final String API_KEYS_PATH = "/v1/auth/api-keys";
    // PUT reports (wiki pages, Apuntes files): what the "report" scope opens.
    // Matched on the raw URI like every exemption here, so an encoded or odd
    // path only ever fails the match and is denied.
    private static final java.util.regex.Pattern REPORT_PATHS = java.util.regex.Pattern.compile(
        "^/v1/wiki/(kb/pages|files)/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/report$");

    private final AuthProperties auth;
    private final ApiKeyService apiKeyService;
    private final CeitbaStaffRepository staffRepository;
    private final CeitbaModeratorRepository moderatorRepository;
    // Spring's configured mapper, so the 403 body is serialized like every
    // other error response (GlobalExceptionHandler).
    private final ObjectMapper json;

    public ApiKeyFilter(AuthProperties auth, ApiKeyService apiKeyService,
                        CeitbaStaffRepository staffRepository,
                        CeitbaModeratorRepository moderatorRepository,
                        ObjectMapper json) {
        this.auth                = auth;
        this.apiKeyService       = apiKeyService;
        this.staffRepository     = staffRepository;
        this.moderatorRepository = moderatorRepository;
        this.json                = json;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {
        String key = req.getHeader(HEADER);
        if (key != null) {
            if (key.startsWith(ApiKeyService.PREFIX)) {
                var validated = apiKeyService.validate(key);
                if (validated.isPresent()) {
                    var k = validated.get();
                    String denial = scopeDenial(k, req.getMethod(), pathWithinApplication(req));
                    if (denial != null) {
                        deny(req, res, denial);
                        return;
                    }
                    var authentication = new UsernamePasswordAuthenticationToken(k.user(), null, authorities(k));
                    authentication.setDetails(k);
                    SecurityContextHolder.getContext().setAuthentication(authentication);
                }
            } else if (matchesSyncKey(key)) {
                SecurityContextHolder.getContext().setAuthentication(
                    new UsernamePasswordAuthenticationToken(
                        "sync-job", null, AuthorityUtils.createAuthorityList("ROLE_SYNC")));
            }
        }
        chain.doFilter(req, res);
    }

    private ArrayList<GrantedAuthority> authorities(ApiKeyService.ValidatedKey k) {
        var authorities = new ArrayList<GrantedAuthority>();
        authorities.add(new SimpleGrantedAuthority("ROLE_USER"));
        for (var s : k.scopes()) authorities.add(new SimpleGrantedAuthority("SCOPE_" + s.key()));
        // Same rule as StaffPowers (services); here the key isn't in the context yet.
        if (!k.has(ApiKeyScope.STAFF)) return authorities;
        var userId = k.user().getId();
        boolean isStaff = staffRepository.isActiveStaff(userId, OffsetDateTime.now());
        if (isStaff) {
            authorities.add(new SimpleGrantedAuthority("ROLE_STAFF"));
        }
        if (isStaff || moderatorRepository.isActiveModerator(userId)) {
            authorities.add(new SimpleGrantedAuthority("ROLE_MODERATOR"));
        }
        return authorities;
    }

    // null when the key's scopes allow the request, otherwise the denial message.
    static String scopeDenial(ApiKeyService.ValidatedKey k, String method, String path) {
        boolean safe = isSafe(method);
        // Any key may revoke itself (DELETE /v1/auth/api-keys/{its own id}), so
        // a client holding a scoped key (apps/mcp) can clean up on logout.
        if (k.keyId() != null && "DELETE".equalsIgnoreCase(method)
                && path.equals(API_KEYS_PATH + "/" + k.keyId())) {
            return null;
        }
        if (!k.has(ApiKeyScope.WRITE) && !safe && !READ_STYLE_POSTS.contains(path)) {
            if (k.has(ApiKeyScope.REPORT) && "PUT".equalsIgnoreCase(method) && REPORT_PATHS.matcher(path).matches()) {
                return null;
            }
            return k.has(ApiKeyScope.REPORT)
                ? "This API key can only read and report content (missing scope: write)"
                : "This API key is read-only (missing scope: write)";
        }
        return null;
    }

    private static boolean isSafe(String method) {
        return "GET".equalsIgnoreCase(method) || "HEAD".equalsIgnoreCase(method)
            || "OPTIONS".equalsIgnoreCase(method);
    }

    private void deny(HttpServletRequest req, HttpServletResponse res, String message) throws IOException {
        res.setStatus(HttpStatus.FORBIDDEN.value());
        res.setContentType(MediaType.APPLICATION_JSON_VALUE);
        json.writeValue(res.getOutputStream(), ErrorResponse.of(INSUFFICIENT_SCOPE, message, req.getRequestURI()));
    }

    private static String pathWithinApplication(HttpServletRequest request) {
        String uri = request.getRequestURI();
        String ctx = request.getContextPath();
        return (ctx != null && !ctx.isEmpty() && uri.startsWith(ctx)) ? uri.substring(ctx.length()) : uri;
    }

    // Constant-time comparison: String.equals returns at the first differing
    // character, leaking how much of a guessed key is right through timing.
    // An unset key (AUTH_SYNC_API_KEY defaults to empty) never matches, so an
    // empty X-Api-Key header cannot be mistaken for the sync key.
    private boolean matchesSyncKey(String key) {
        if (auth.syncApiKey() == null || auth.syncApiKey().isBlank()) return false;
        return MessageDigest.isEqual(
            key.getBytes(StandardCharsets.UTF_8),
            auth.syncApiKey().getBytes(StandardCharsets.UTF_8));
    }
}
