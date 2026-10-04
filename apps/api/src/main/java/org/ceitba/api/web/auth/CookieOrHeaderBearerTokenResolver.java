package org.ceitba.api.web.auth;

import jakarta.servlet.http.HttpServletRequest;
import org.ceitba.api.config.AuthProperties;
import org.springframework.security.oauth2.server.resource.web.BearerTokenResolver;
import org.springframework.security.oauth2.server.resource.web.DefaultBearerTokenResolver;
import org.springframework.stereotype.Component;

import java.util.List;
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
// app calls /refresh) must not turn them into a 401. The same goes for the
// weekly digest one-click unsubscribe (signed token in the URL) and the
// digest's correction vote page (GET and POST, signed token): a stale
// session cookie of the person following the link must not reject it.
// Same for the digest's open pixel and click redirects (/v1/mail/**).
@Component
public class CookieOrHeaderBearerTokenResolver implements BearerTokenResolver {

    private final DefaultBearerTokenResolver headerResolver = new DefaultBearerTokenResolver();
    private final String cookieName;

    public CookieOrHeaderBearerTokenResolver(AuthProperties auth) {
        this.cookieName = auth.cookie().name();
    }

    static final Set<String> TOKEN_ENDPOINTS = Set.of(
        "/v1/auth/google/mobile", "/v1/auth/refresh", "/v1/auth/logout", "/v1/auth/review-login",
        "/v1/digests/unsubscribe");

    // Token-authenticated for every method.
    static final Set<String> TOKEN_PATHS_ANY_METHOD = Set.of("/v1/digests/correction-vote");

    // Public, never authenticated: the digest's open pixel and click
    // redirects (a stale cookie of the reader must not turn them into 401s),
    // and the Gmail OAuth callback (authenticated by its signed state). Only
    // these: the rest of /v1/mail/accounts is STAFF and needs the cookie.
    static final List<String> PUBLIC_MAIL_PREFIXES = List.of("/v1/mail/o/", "/v1/mail/c/");
    static final String MAIL_OAUTH_CALLBACK = "/v1/mail/accounts/oauth/callback";

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
        String uri = request.getRequestURI();
        String ctx = request.getContextPath();
        String path = (ctx != null && !ctx.isEmpty() && uri.startsWith(ctx)) ? uri.substring(ctx.length()) : uri;
        if (TOKEN_PATHS_ANY_METHOD.contains(path) || MAIL_OAUTH_CALLBACK.equals(path)) return true;
        if (PUBLIC_MAIL_PREFIXES.stream().anyMatch(path::startsWith)) return true;
        if (!"POST".equalsIgnoreCase(request.getMethod())) return false;
        return TOKEN_ENDPOINTS.contains(path);
    }
}
