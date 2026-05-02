package org.ceitba.api.web.auth;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.ceitba.api.config.AuthProperties;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.AuthorityUtils;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

// Static-key check for /api/v1/sync/**. If the configured key is set and
// the X-API-Key header matches, the request is treated as authenticated as
// a synthetic principal "sync-job".
public class ApiKeyFilter extends OncePerRequestFilter {

    public static final String HEADER = "X-API-Key";

    private final AuthProperties auth;

    public ApiKeyFilter(AuthProperties auth) {
        this.auth = auth;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {
        String header = req.getHeader(HEADER);
        if (header != null && auth.syncApiKey() != null && header.equals(auth.syncApiKey())) {
            var token = new UsernamePasswordAuthenticationToken(
                "sync-job", null, AuthorityUtils.createAuthorityList("ROLE_SYNC"));
            SecurityContextHolder.getContext().setAuthentication(token);
        }
        chain.doFilter(req, res);
    }
}
