package org.ceitba.api.config;

import org.ceitba.api.web.auth.ApiKeyFilter;
import org.ceitba.api.web.auth.StaffAwareJwtAuthenticationConverter;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.List;

// Endpoint policy:
//   public:        GET on health/careers/subjects/plans/classrooms;
//                  GET on wiki bookmarks; POST /v1/classrooms/conflicts;
//                  POST /v1/users/create + GET /v1/users/** (parity with NestJS — TODO).
//   API key:       /v1/sync/**                   -> ROLE_SYNC
//   Google OIDC:   POST/PUT/DELETE bookmarks     -> ROLE_USER (any authed allowlisted)
//                  /v1/staff/**                  -> ROLE_STAFF (active CeitbaStaff row)
//
// Allowlist (auth.allowed-domains + auth.allowed-emails) is enforced inside
// StaffAwareJwtAuthenticationConverter, which also adds ROLE_STAFF when the
// authenticated user has an active CeitbaStaff row. @EnableMethodSecurity
// activates @PreAuthorize on controller methods for fine-grained checks where
// path matchers don't fit.
@Configuration
@EnableConfigurationProperties(AuthProperties.class)
@EnableMethodSecurity
public class SecurityConfig {

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http,
                                                   AuthProperties auth,
                                                   StaffAwareJwtAuthenticationConverter jwtConverter) throws Exception {
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
                .requestMatchers(HttpMethod.POST, "/v1/classrooms/conflicts", "/v1/users/create").permitAll()
                .requestMatchers("/v1/sync/**").hasRole("SYNC")
                .requestMatchers("/v1/staff/**").hasRole("STAFF")
                .anyRequest().authenticated()
            )
            .oauth2ResourceServer(oauth -> oauth.jwt(jwt -> jwt.jwtAuthenticationConverter(jwtConverter)));

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
