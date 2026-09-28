package org.ceitba.api.web.auth;

import jakarta.servlet.http.HttpServletRequest;
import org.ceitba.api.config.AuthProperties;
import org.springframework.security.oauth2.server.resource.web.BearerTokenResolver;
import org.springframework.security.oauth2.server.resource.web.DefaultBearerTokenResolver;
import org.springframework.stereotype.Component;

import java.util.Set;

// Resolves the bearer token from either:
//   1. Authorization: Bearer header  -> kept for curl / API clients / scheduler.
//   2. HttpOnly session cookie       -> the only way SPAs authenticate.
//
// Header is preferred when both are present so that an API client can override
// a stale session cookie by setting Authorization explicitly.
//
// The public token endpoints never read a bearer token: they authenticate via
// their request body, and an expired access token (the normal state when the
// app calls /refresh) must not turn them into a 401.
@Component
public class CookieOrHeaderBearerTokenResolver implements BearerTokenResolver {

    private final DefaultBearerTokenResolver headerResolver = new DefaultBearerTokenResolver();
    private final String cookieName;

    public CookieOrHeaderBearerTokenResolver(AuthProperties auth) {
        this.cookieName = auth.cookie().name();
    }

    static final Set<String> TOKEN_ENDPOINTS = Set.of(
        "/v1/auth/google/mobile", "/v1/auth/refresh", "/v1/auth/logout");

    @Override
    public String resolve(HttpServletRequest request) {
        if (isTokenEndpoint(request)) return null;

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

    private static boolean isTokenEndpoint(HttpServletRequest request) {
        if (!"POST".equalsIgnoreCase(request.getMethod())) return false;
        String uri = request.getRequestURI();
        String ctx = request.getContextPath();
        String path = (ctx != null && !ctx.isEmpty() && uri.startsWith(ctx)) ? uri.substring(ctx.length()) : uri;
        return TOKEN_ENDPOINTS.contains(path);
    }
}
