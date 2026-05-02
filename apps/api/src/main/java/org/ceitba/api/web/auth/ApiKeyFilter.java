package org.ceitba.api.web.auth;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.ceitba.api.config.AuthProperties;
import org.ceitba.api.repository.CeitbaStaffRepository;
import org.ceitba.api.service.auth.ApiKeyService;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.AuthorityUtils;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.OffsetDateTime;
import java.util.ArrayList;

// Processes the X-Api-Key header before the JWT resource-server filter runs.
//
//   ceitba_* keys  →  user API key: looked up by SHA-256 hash in the DB;
//                     grants ROLE_USER (+ ROLE_STAFF if active staff row exists).
//   anything else  →  sync job static key: compared to auth.sync-api-key;
//                     grants ROLE_SYNC.
public class ApiKeyFilter extends OncePerRequestFilter {

    public static final String HEADER = "X-Api-Key";

    private final AuthProperties auth;
    private final ApiKeyService apiKeyService;
    private final CeitbaStaffRepository staffRepository;

    public ApiKeyFilter(AuthProperties auth, ApiKeyService apiKeyService,
                        CeitbaStaffRepository staffRepository) {
        this.auth            = auth;
        this.apiKeyService   = apiKeyService;
        this.staffRepository = staffRepository;
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
                    if (staffRepository.isActiveStaff(user.getId(), OffsetDateTime.now())) {
                        authorities.add(new SimpleGrantedAuthority("ROLE_STAFF"));
                    }
                    SecurityContextHolder.getContext().setAuthentication(
                        new UsernamePasswordAuthenticationToken(user, null, authorities));
                });
            } else if (auth.syncApiKey() != null && key.equals(auth.syncApiKey())) {
                SecurityContextHolder.getContext().setAuthentication(
                    new UsernamePasswordAuthenticationToken(
                        "sync-job", null, AuthorityUtils.createAuthorityList("ROLE_SYNC")));
            }
        }
        chain.doFilter(req, res);
    }
}
