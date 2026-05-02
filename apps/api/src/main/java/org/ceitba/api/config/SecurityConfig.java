package org.ceitba.api.config;

import org.ceitba.api.web.auth.ApiKeyFilter;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.oauth2.server.resource.authentication.JwtGrantedAuthoritiesConverter;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.List;

// Endpoint policy (per MIGRATION.md PR 10):
//   public:        GET on health/careers/subjects/plans/classrooms;
//                  GET on wiki bookmarks; POST /v1/classrooms/conflicts;
//                  POST /v1/users/create  (parity with NestJS — TODO)
//   API key:       /v1/sync/**
//   Google OIDC:   everything else (POST/PUT/DELETE on bookmarks)
//
// Allowlist (auth.allowed-domains + auth.allowed-emails) is enforced once
// inside the JWT converter — controllers never need to check.
@Configuration
@EnableConfigurationProperties(AuthProperties.class)
public class SecurityConfig {

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http, AuthProperties auth) throws Exception {
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
                    "/v1/wiki/bookmarks/*",
                    "/v1/users/**"   // parity with NestJS — TODO lock down
                ).permitAll()
                // Public POSTs (parity with current NestJS — TODO: lock down post-cutover):
                //   POST /v1/classrooms/conflicts  — read-style query, no writes
                //   POST /v1/users/create          — currently no auth; revisit when
                //                                    self-service signup is ruled out
                .requestMatchers(HttpMethod.POST, "/v1/classrooms/conflicts", "/v1/users/create").permitAll()
                .requestMatchers("/v1/sync/**").hasRole("SYNC")
                .anyRequest().authenticated()
            )
            .oauth2ResourceServer(oauth -> oauth.jwt(jwt -> jwt.jwtAuthenticationConverter(jwtConverter(auth))));

        return http.build();
    }

    private static JwtAuthenticationConverter jwtConverter(AuthProperties auth) {
        var grants = new JwtGrantedAuthoritiesConverter();
        grants.setAuthorityPrefix("ROLE_");

        var converter = new JwtAuthenticationConverter();
        converter.setJwtGrantedAuthoritiesConverter(jwt -> {
            String email = jwt.getClaimAsString("email");
            if (email == null || !auth.admits(email)) {
                throw new AccessDeniedException("Email not authorized: " + email);
            }
            var defaults = grants.convert(jwt);
            return defaults != null ? defaults : List.of();
        });
        return converter;
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
