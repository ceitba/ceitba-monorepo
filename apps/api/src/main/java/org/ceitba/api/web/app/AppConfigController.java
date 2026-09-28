package org.ceitba.api.web.app;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.ceitba.api.config.MobileAppProperties;
import org.ceitba.api.web.app.dto.AppConfigResponse;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Duration;

// Public, properties-backed release control the mobile app reads on launch
// (minimum supported version, latest version, maintenance kill switch).
@Tag(name = "App")
@RestController
@RequestMapping("/v1/app")
@EnableConfigurationProperties(MobileAppProperties.class)
public class AppConfigController {

    private final MobileAppProperties props;

    public AppConfigController(MobileAppProperties props) {
        this.props = props;
    }

    @GetMapping("/config")
    @Operation(summary = "Mobile app release control: minimum and latest version, maintenance flag")
    public ResponseEntity<AppConfigResponse> config() {
        return ResponseEntity.ok()
            .cacheControl(CacheControl.maxAge(Duration.ofMinutes(1)).cachePublic())
            .body(new AppConfigResponse(props.minVersion(), props.latestVersion(), props.maintenance()));
    }
}
