package org.ceitba.api.web.auth;

import jakarta.servlet.http.HttpServletRequest;
import org.ceitba.api.config.AuthProperties;
import org.springframework.security.oauth2.server.resource.web.BearerTokenResolver;
import org.springframework.security.oauth2.server.resource.web.DefaultBearerTokenResolver;
import org.springframework.stereotype.Component;

// Resolves the bearer token from either:
//   1. Authorization: Bearer header  -> kept for curl / API clients / scheduler.
//   2. HttpOnly session cookie       -> the only way SPAs authenticate.
//
// Header is preferred when both are present so that an API client can override
// a stale session cookie by setting Authorization explicitly.
@Component
public class CookieOrHeaderBearerTokenResolver implements BearerTokenResolver {

    private final DefaultBearerTokenResolver headerResolver = new DefaultBearerTokenResolver();
    private final String cookieName;

    public CookieOrHeaderBearerTokenResolver(AuthProperties auth) {
        this.cookieName = auth.cookie().name();
    }

    @Override
    public String resolve(HttpServletRequest request) {
        String fromHeader = headerResolver.resolve(request);
        if (fromHeader != null) return fromHeader;

        var cookies = request.getCookies();
        if (cookies == null) return null;
        for (var c : cookies) {
            if (cookieName.equals(c.getName())) {
                String v = c.getValue();
                return (v == null || v.isBlank()) ? null : v;
            }
        }
        return null;
    }
}
