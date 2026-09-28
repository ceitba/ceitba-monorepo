package org.ceitba.api.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

// Firebase Cloud Messaging credentials for server-side pushes (service/push).
//   FIREBASE_SERVICE_ACCOUNT_JSON  the service-account key JSON itself, raw or
//                                  base64-encoded (handy in .env files)
//   FIREBASE_SERVICE_ACCOUNT_PATH  or a path to that JSON file
// Neither set = pushes are disabled (NoOpPushNotificationService). When both
// are set the JSON wins.
@ConfigurationProperties(prefix = "push.fcm")
public record PushProperties(String serviceAccountJson, String serviceAccountPath) {

    public PushProperties {
        serviceAccountJson = blankToNull(serviceAccountJson);
        serviceAccountPath = blankToNull(serviceAccountPath);
    }

    public boolean configured() {
        return serviceAccountJson != null || serviceAccountPath != null;
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
