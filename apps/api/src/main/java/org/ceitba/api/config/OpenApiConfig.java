package org.ceitba.api.config;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.security.SecurityScheme;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class OpenApiConfig {

    @Bean
    public OpenAPI ceitbaOpenAPI() {
        return new OpenAPI()
            .info(new Info()
                .title("CEITBA API")
                .description("CEITBA API for managing ITBA academic data and users")
                .version("1.0.0"))
            .components(new Components()
                .addSecuritySchemes("bearerAuth", new SecurityScheme()
                    .type(SecurityScheme.Type.HTTP)
                    .scheme("bearer")
                    .bearerFormat("JWT")
                    .description("CEITBA-issued HS256 JWT (never a Google token). Web SPAs receive it as the "
                        + "HttpOnly session cookie after GET /v1/auth/google; the mobile app gets it from "
                        + "POST /v1/auth/google/mobile (Google ID token exchange) and renews it with "
                        + "POST /v1/auth/refresh. Send it as Authorization: Bearer <jwt>."))
                .addSecuritySchemes("apiKey", new SecurityScheme()
                    .type(SecurityScheme.Type.APIKEY)
                    .in(SecurityScheme.In.HEADER)
                    .name("X-API-Key")
                    .description("Either the static AUTH_SYNC_API_KEY for /v1/sync/** (cron / ops), "
                        + "or a per-user ceitba_* key created via POST /v1/auth/api-keys.")));
    }
}
