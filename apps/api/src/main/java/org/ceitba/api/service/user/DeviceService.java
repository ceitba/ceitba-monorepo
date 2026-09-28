package org.ceitba.api.service.user;

import org.ceitba.api.domain.UserDevice;
import org.ceitba.api.repository.UserDeviceRepository;
import org.ceitba.api.web.user.dto.DeviceResponse;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

// Push-notification device registry behind /v1/me/devices. The mobile app
// registers its FCM token after login and whenever FCM rotates it, and
// unregisters it on logout. Sending lives in service/push.
@Service
public class DeviceService {

    // Bounds the rows one account can create (every PUT with a new token adds
    // one). Beyond this, the least recently seen devices are dropped.
    public static final int MAX_DEVICES_PER_USER = 10;

    private final UserDeviceRepository devices;
    private final Clock clock;

    public DeviceService(UserDeviceRepository devices, Clock clock) {
        this.devices = devices;
        this.clock   = clock;
    }

    // Idempotent upsert keyed by token. A token currently registered to
    // another user is reassigned to `userId` (same phone, different account),
    // so the previous owner stops receiving pushes on it.
    @Transactional
    public DeviceResponse register(UUID userId, String token, String platform, String appVersion) {
        var now = OffsetDateTime.now(clock).truncatedTo(ChronoUnit.MICROS);
        var version = appVersion == null || appVersion.isBlank() ? null : appVersion.trim();
        devices.upsert(token, userId, platform.toLowerCase(Locale.ROOT), version, now);
        devices.trimForUser(userId, MAX_DEVICES_PER_USER);
        return devices.findById(token).map(DeviceService::toResponse).orElseThrow();
    }

    @Transactional(readOnly = true)
    public List<DeviceResponse> list(UUID userId) {
        return devices.findByUserIdOrderByLastSeenAtDesc(userId).stream()
            .map(DeviceService::toResponse)
            .toList();
    }

    // Idempotent: removing a token that is unknown or registered to someone
    // else is a silent no-op, so the endpoint does not reveal other users'
    // tokens and a logout retry never fails.
    @Transactional
    public void unregister(UUID userId, String token) {
        devices.deleteByTokenAndUserId(token, userId);
    }

    private static DeviceResponse toResponse(UserDevice d) {
        return new DeviceResponse(d.getToken(), d.getPlatform(), d.getAppVersion(),
                                  d.getCreatedAt(), d.getLastSeenAt());
    }
}
