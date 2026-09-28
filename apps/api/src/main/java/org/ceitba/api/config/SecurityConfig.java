package org.ceitba.api.config;

import org.ceitba.api.repository.CeitbaModeratorRepository;
import org.ceitba.api.repository.CeitbaStaffRepository;
import org.ceitba.api.service.auth.ApiKeyService;
import org.ceitba.api.service.auth.SessionAllowlist;
import org.ceitba.api.web.auth.ApiKeyFilter;
import org.ceitba.api.web.auth.CookieOrHeaderBearerTokenResolver;
import org.ceitba.api.web.auth.IssuerAudienceValidator;
import org.ceitba.api.web.auth.StaffAwareJwtAuthenticationConverter;
import org.ceitba.api.web.ratelimit.RateLimitFilter;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.authorization.AuthenticatedAuthorizationManager;
import org.springframework.security.authorization.AuthorityAuthorizationManager;
import org.springframework.security.authorization.AuthorizationDecision;
import org.springframework.security.authorization.AuthorizationManager;
import org.springframework.security.authorization.AuthorizationManagers;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.access.intercept.RequestAuthorizationContext;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.CorsFilter;

import javax.crypto.spec.SecretKeySpec;
import java.util.Base64;
import java.util.List;

// Endpoint policy:
//   public:        GET on health/careers/subjects/plans/classrooms;
//                  GET on wiki bookmarks; POST /v1/classrooms/conflicts.
//                  GET /v1/auth/google, GET /v1/auth/callback  (web OAuth flow)
//                  POST /v1/auth/google/mobile, /v1/auth/refresh, /v1/auth/logout
//                  POST /v1/auth/review-login  (store review account; 404 unless configured)
//                  GET /v1/app/config
//   API key:       /v1/sync/**                       -> ROLE_SYNC  (X-Api-Key header)
//                  /v1/auth/api-keys/**              -> ROLE_USER  (X-Api-Key header, user keys)
//   Bearer JWT:    POST/PUT/DELETE on wiki bookmarks -> ROLE_USER (any allowlisted)
//                  /v1/staff/proposals/**            -> ROLE_MODERATOR (+ allowlist), carved out of:
//                  /v1/staff/**                      -> ROLE_STAFF (path matcher; incl. /v1/staff/moderators)
//                  /v1/users/**                      -> ROLE_STAFF (@PreAuthorize)
//                  /v1/careers/{POST,PUT,DELETE}     -> ROLE_STAFF (@PreAuthorize)
//                  /v1/plans/.../subject writes      -> ROLE_STAFF (@PreAuthorize)
//
// JWTs are now issued by us (HS256, AUTH_JWT_SECRET), not forwarded Google tokens.
// The JwtDecoder bean below validates against our signing key.
//
// Allowlist (auth.allowed-domains + auth.allowed-emails, plus the review
// account while review login is enabled: see SessionAllowlist) is enforced as an
// AuthorizationManager: post-decode, pre-controller. Living here (vs in the
// JwtAuthenticationConverter) keeps the converter focused on extracting
// authorities AND lets MockMvc tests with .with(jwt()) actually exercise it.
// StaffAwareJwtAuthenticationConverter adds ROLE_USER, ROLE_STAFF when the
// authenticated user has an active CeitbaStaff row, and ROLE_MODERATOR for
// active staff or an active ceitba_moderators grant. @EnableMethodSecurity
// activates @PreAuthorize on controller methods for fine-grained checks.
@Configuration
@EnableConfigurationProperties({AuthProperties.class, RateLimitProperties.class, ReviewLoginProperties.class})
@EnableMethodSecurity
public class SecurityConfig {

    // Validates our own HS256 JWTs issued by JwtIssuerService after Google OAuth.
    // Requires AUTH_JWT_SECRET env var (base64-encoded, 32+ bytes).
    @Bean
    public JwtDecoder jwtDecoder(AuthProperties auth) {
        if (auth.jwt() == null || auth.jwt().secret() == null || auth.jwt().secret().isBlank()) {
            throw new IllegalStateException(
                "auth.jwt.secret (AUTH_JWT_SECRET) must be configured. " +
                "Generate with: openssl rand -base64 32");
        }
        byte[] secret = Base64.getDecoder().decode(auth.jwt().secret());
        var decoder = NimbusJwtDecoder.withSecretKey(new SecretKeySpec(secret, "HmacSHA256")).build();
        // Default validators (exp/nbf) + iss/aud, phased in: see IssuerAudienceValidator.
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(
            JwtValidators.createDefault(),
            new IssuerAudienceValidator(auth.jwt().issuer(), AuthProperties.Jwt.AUDIENCE,
                                        auth.jwt().enforceIssuerAudience())));
        return decoder;
    }

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http,
                                                   AuthProperties auth,
                                                   SessionAllowlist sessionAllowlist,
                                                   StaffAwareJwtAuthenticationConverter jwtConverter,
                                                   JwtDecoder jwtDecoder,
                                                   CookieOrHeaderBearerTokenResolver bearerResolver,
                                                   ApiKeyService apiKeyService,
                                                   CeitbaStaffRepository staffRepository,
                                                   CeitbaModeratorRepository moderatorRepository,
                                                   RateLimitProperties rateLimit) throws Exception {
        // Allowlist gate runs only AFTER `authenticated()` accepts. Order matters:
        // chaining via allOf lets the framework return 401 for missing auth and
        // 403 only for allowlist denials.
        AuthorizationManager<RequestAuthorizationContext> emailAllowlisted =
            (authentication, context) -> {
                var a = authentication.get();
                if (a instanceof JwtAuthenticationToken jwtAuth) {
                    Jwt jwt = jwtAuth.getToken();
                    String email = jwt.getClaimAsString("email");
                    return new AuthorizationDecision(sessionAllowlist.admits(email));
                }
                // Non-JWT authentications (e.g. ROLE_SYNC API-key principal) pass through
                return new AuthorizationDecision(true);
            };

        AuthorizationManager<RequestAuthorizationContext> authenticatedAndAllowlisted =
            AuthorizationManagers.allOf(
                AuthenticatedAuthorizationManager.authenticated(),
                emailAllowlisted
            );

        http
            .csrf(csrf -> csrf.disable())
            .cors(cors -> cors.configurationSource(corsSource()))
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            // Per-IP rate limiting runs right after CORS (so 429s are readable
            // by browsers) and before any authentication work.
            .addFilterAfter(new RateLimitFilter(rateLimit), CorsFilter.class)
            .addFilterBefore(new ApiKeyFilter(auth, apiKeyService, staffRepository, moderatorRepository),
                             UsernamePasswordAuthenticationFilter.class)
            .authorizeHttpRequests(reg -> reg
                .requestMatchers(HttpMethod.GET,
                    "/", "/health",
                    "/actuator/health", "/actuator/info",
                    "/docs", "/docs/**", "/docs.json", "/docs.json/**", "/v3/api-docs/**", "/swagger-ui/**",
                    "/v1/careers/**",
                    "/v1/subjects/**",
                    "/v1/plans/**",
                    "/v1/classrooms/**",
                    "/v1/commissions",
                    "/v1/wiki/bookmarks/*",
                    "/v1/auth/google", "/v1/auth/callback",
                    // Newsletter public reads
                    "/v1/organizations/**",
                    "/v1/articles/**",
                    "/v1/news/events/**",
                    // CeitbaPage CMS public reads (writes are @PreAuthorize'd)
                    "/v1/staff-departments",
                    "/v1/staff-members",
                    "/v1/staff-members/years",
                    "/v1/benefits",
                    "/v1/benefit-cards",
                    // Mobile home carousel (GET /v1/highlights/all is STAFF-only).
                    "/v1/highlights",
                    // Public read of share-session by token; writes are JWT-gated.
                    "/v1/share/sessions/*",
                    // Mobile app release control (min version / maintenance).
                    "/v1/app/config"
                ).permitAll()
                // POST /v1/classrooms/conflicts is a read-style query (no writes); public.
                .requestMatchers(HttpMethod.POST, "/v1/classrooms/conflicts").permitAll()
                // Vote casting and analytics ingestion are public (fingerprint-deduplicated)
                .requestMatchers(HttpMethod.POST, "/v1/articles/*/votes").permitAll()
                .requestMatchers(HttpMethod.DELETE, "/v1/articles/*/votes").permitAll()
                .requestMatchers(HttpMethod.POST, "/v1/analytics/events").permitAll()
                // Logout must be reachable even with an expired/invalid cookie.
                // The mobile token endpoints authenticate via their body
                // (Google ID token / refresh token / review credentials), not a bearer JWT.
                .requestMatchers(HttpMethod.POST,
                    "/v1/auth/logout", "/v1/auth/google/mobile", "/v1/auth/refresh",
                    "/v1/auth/review-login").permitAll()
                .requestMatchers("/v1/sync/**").hasRole("SYNC")
                // Proposal moderation is the narrow MODERATOR grant, not STAFF.
                .requestMatchers("/v1/staff/proposals", "/v1/staff/proposals/**")
                    .access(AuthorizationManagers.allOf(
                        AuthorityAuthorizationManager.hasRole("MODERATOR"), emailAllowlisted))
                .requestMatchers("/v1/staff/**").hasRole("STAFF")
                .anyRequest().access(authenticatedAndAllowlisted)
            )
            .oauth2ResourceServer(oauth -> {
                oauth.bearerTokenResolver(bearerResolver);
                oauth.jwt(jwt -> {
                    jwt.jwtAuthenticationConverter(jwtConverter);
                    jwt.decoder(jwtDecoder);
                });
            });

        return http.build();
    }

    private static CorsConfigurationSource corsSource() {
        var c = new CorsConfiguration();
        c.setAllowedOrigins(List.of(
            "https://ceitba.org.ar",
            "https://itbanews.ar", "https://www.itbanews.ar",
            "http://localhost:3000", "http://localhost:3001", "http://localhost:5173", "http://localhost:5175"
        ));
        c.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"));
        c.setAllowedHeaders(List.of("Content-Type", "Authorization", "X-Requested-With", ApiKeyFilter.HEADER));
        c.setAllowCredentials(true);
        var src = new UrlBasedCorsConfigurationSource();
        src.registerCorsConfiguration("/**", c);
        return src;
    }
}
