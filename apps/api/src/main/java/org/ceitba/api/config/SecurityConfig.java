package org.ceitba.api.config;

import org.ceitba.api.web.auth.ApiKeyFilter;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.authorization.AuthenticatedAuthorizationManager;
import org.springframework.security.authorization.AuthorizationDecision;
import org.springframework.security.authorization.AuthorizationManager;
import org.springframework.security.authorization.AuthorizationManagers;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.access.intercept.RequestAuthorizationContext;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.List;

// Endpoint policy:
//   public:        GET on health/careers/subjects/plans/classrooms;
//                  GET on wiki bookmarks; POST /v1/classrooms/conflicts.
//   API key:       /v1/sync/**
//   Google OIDC:   POST/PUT/DELETE on wiki bookmarks; everything under /v1/users.
//                  Self-service signup is intentionally NOT supported — User rows
//                  are JIT-provisioned by CurrentUserResolver on first authenticated
//                  request.
//
// Allowlist (auth.allowed-domains + auth.allowed-emails) is enforced as an
// AuthorizationManager: post-decode, pre-controller. Living here (vs in the
// JwtAuthenticationConverter) keeps the converter focused on extracting
// authorities AND lets MockMvc tests with .with(jwt()) actually exercise it.
@Configuration
@EnableConfigurationProperties(AuthProperties.class)
public class SecurityConfig {

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http, AuthProperties auth) throws Exception {
        // Allowlist gate runs only AFTER `authenticated()` accepts. Order matters:
        // chaining via allOf lets the framework return 401 for missing auth and
        // 403 only for allowlist denials.
        AuthorizationManager<RequestAuthorizationContext> emailAllowlisted =
            (authentication, context) -> {
                var a = authentication.get();
                if (a instanceof JwtAuthenticationToken jwtAuth) {
                    Jwt jwt = jwtAuth.getToken();
                    String email = jwt.getClaimAsString("email");
                    return new AuthorizationDecision(email != null && auth.admits(email));
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
            .addFilterBefore(new ApiKeyFilter(auth), UsernamePasswordAuthenticationFilter.class)
            .authorizeHttpRequests(reg -> reg
                .requestMatchers(HttpMethod.GET,
                    "/", "/health",
                    "/actuator/health", "/actuator/info",
                    "/docs", "/docs.json", "/docs/**", "/v3/api-docs/**", "/swagger-ui/**",
                    "/v1/careers/**",
                    "/v1/subjects/**",
                    "/v1/plans/**",
                    "/v1/classrooms/**",
                    "/v1/wiki/bookmarks/*"
                ).permitAll()
                // POST /v1/classrooms/conflicts is a read-style query (no writes); public.
                .requestMatchers(HttpMethod.POST, "/v1/classrooms/conflicts").permitAll()
                .requestMatchers("/v1/sync/**").hasRole("SYNC")
                .anyRequest().access(authenticatedAndAllowlisted)
            )
            .oauth2ResourceServer(oauth -> oauth.jwt());

        return http.build();
    }

    private static CorsConfigurationSource corsSource() {
        var c = new CorsConfiguration();
        c.setAllowedOrigins(List.of("https://ceitba.org.ar", "http://localhost:3000", "http://localhost:3001"));
        c.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"));
        c.setAllowedHeaders(List.of("Content-Type", "Authorization", "X-Requested-With", ApiKeyFilter.HEADER));
        c.setAllowCredentials(true);
        var src = new UrlBasedCorsConfigurationSource();
        src.registerCorsConfiguration("/**", c);
        return src;
    }
}
