package org.ceitba.api.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

// Release control for the mobile app, served by GET /v1/app/config.
//   MOBILE_MIN_VERSION=1.0.0      app blocks and asks to update below this
//   MOBILE_LATEST_VERSION=1.0.0   app suggests updating below this
//   MOBILE_MAINTENANCE=false      kill switch: app shows a maintenance screen
@ConfigurationProperties(prefix = "mobile-app")
public record MobileAppProperties(String minVersion, String latestVersion, Boolean maintenance) {
    public MobileAppProperties {
        minVersion    = (minVersion == null || minVersion.isBlank()) ? "0.0.0" : minVersion.trim();
        latestVersion = (latestVersion == null || latestVersion.isBlank()) ? minVersion : latestVersion.trim();
        maintenance   = Boolean.TRUE.equals(maintenance);
    }
}
