package org.ceitba.api.web.auth;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.ceitba.api.config.AuthProperties;
import org.ceitba.api.repository.CeitbaModeratorRepository;
import org.ceitba.api.repository.CeitbaStaffRepository;
import org.ceitba.api.service.auth.ApiKeyService;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.AuthorityUtils;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.OffsetDateTime;
import java.util.ArrayList;

// Processes the X-Api-Key header before the JWT resource-server filter runs.
//
//   ceitba_* keys  →  user API key: looked up by SHA-256 hash in the DB;
//                     grants ROLE_USER (+ ROLE_STAFF and ROLE_MODERATOR if an
//                     active staff row exists, + ROLE_MODERATOR for an active
//                     moderator grant), same as StaffAwareJwtAuthenticationConverter.
//   anything else  →  sync job static key: compared to auth.sync-api-key;
//                     grants ROLE_SYNC.
public class ApiKeyFilter extends OncePerRequestFilter {

    public static final String HEADER = "X-Api-Key";

    private final AuthProperties auth;
    private final ApiKeyService apiKeyService;
    private final CeitbaStaffRepository staffRepository;
    private final CeitbaModeratorRepository moderatorRepository;

    public ApiKeyFilter(AuthProperties auth, ApiKeyService apiKeyService,
                        CeitbaStaffRepository staffRepository,
                        CeitbaModeratorRepository moderatorRepository) {
        this.auth                = auth;
        this.apiKeyService       = apiKeyService;
        this.staffRepository     = staffRepository;
        this.moderatorRepository = moderatorRepository;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {
        String key = req.getHeader(HEADER);
        if (key != null) {
            if (key.startsWith(ApiKeyService.PREFIX)) {
                apiKeyService.validate(key).ifPresent(user -> {
                    var authorities = new ArrayList<org.springframework.security.core.GrantedAuthority>();
                    authorities.add(new SimpleGrantedAuthority("ROLE_USER"));
                    boolean isStaff = staffRepository.isActiveStaff(user.getId(), OffsetDateTime.now());
                    if (isStaff) {
                        authorities.add(new SimpleGrantedAuthority("ROLE_STAFF"));
                    }
                    if (isStaff || moderatorRepository.isActiveModerator(user.getId())) {
                        authorities.add(new SimpleGrantedAuthority("ROLE_MODERATOR"));
                    }
                    SecurityContextHolder.getContext().setAuthentication(
                        new UsernamePasswordAuthenticationToken(user, null, authorities));
                });
            } else if (matchesSyncKey(key)) {
                SecurityContextHolder.getContext().setAuthentication(
                    new UsernamePasswordAuthenticationToken(
                        "sync-job", null, AuthorityUtils.createAuthorityList("ROLE_SYNC")));
            }
        }
        chain.doFilter(req, res);
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
