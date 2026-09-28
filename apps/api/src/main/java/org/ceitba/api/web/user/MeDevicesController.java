package org.ceitba.api.web.user;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.ceitba.api.domain.User;
import org.ceitba.api.service.user.DeviceService;
import org.ceitba.api.web.auth.CurrentUser;
import org.ceitba.api.web.user.dto.DeviceResponse;
import org.ceitba.api.web.user.dto.RegisterDeviceRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

// Push-notification device tokens of the current user (USER).
@Tag(name = "Me")
@RestController
@RequestMapping("/v1/me/devices")
public class MeDevicesController {

    private final DeviceService devices;

    public MeDevicesController(DeviceService devices) {
        this.devices = devices;
    }

    @GetMapping
    @Operation(summary = "List the current user's registered push devices, most recently seen first")
    public List<DeviceResponse> list(@CurrentUser User user) {
        return devices.list(user.getId());
    }

    @PutMapping
    @Operation(summary = "Register (or refresh) this install's FCM token. Idempotent; a token registered "
        + "to another account is moved to the caller. Call after login and on every token refresh")
    public DeviceResponse register(@CurrentUser User user, @Valid @RequestBody RegisterDeviceRequest req) {
        return devices.register(user.getId(), req.token(), req.platform(), req.appVersion());
    }

    @DeleteMapping("/{token}")
    @Operation(summary = "Unregister a device token (call on logout). Always 204: unknown tokens and "
        + "tokens of other users are ignored")
    public ResponseEntity<Void> unregister(@CurrentUser User user, @PathVariable String token) {
        devices.unregister(user.getId(), token);
        return ResponseEntity.noContent().build();
    }
}
