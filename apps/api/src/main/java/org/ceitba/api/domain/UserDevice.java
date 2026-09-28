package org.ceitba.api.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.OffsetDateTime;
import java.util.UUID;

// One push-notification target: an FCM registration token of a mobile app
// install (see V23__user_devices.sql). Rows are written through the native
// upsert in UserDeviceRepository; this mapping is for reads.
@Entity
@Table(schema = "public", name = "user_devices")
public class UserDevice {

    @Id
    @Column(name = "token", length = 1024)
    private String token;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "platform", nullable = false, length = 16)
    private String platform;

    @Column(name = "app_version", length = 32)
    private String appVersion;

    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @Column(name = "last_seen_at", nullable = false)
    private OffsetDateTime lastSeenAt;

    protected UserDevice() {}

    public String getToken()              { return token; }
    public UUID getUserId()               { return userId; }
    public String getPlatform()           { return platform; }
    public String getAppVersion()         { return appVersion; }
    public OffsetDateTime getCreatedAt()  { return createdAt; }
    public OffsetDateTime getLastSeenAt() { return lastSeenAt; }
}
