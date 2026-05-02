package org.ceitba.api.web.health;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.lang.management.ManagementFactory;
import java.time.Instant;
import java.util.Map;

@Tag(name = "Health")
@RestController
public class HealthController {

    @Value("${spring.profiles.active:development}")
    private String activeProfile;

    @GetMapping("")
    @Operation(summary = "Get API status")
    public Map<String, Object> getApiStatus() {
        return Map.of(
            "message", "CEITBA API is running",
            "version", "1.0.0",
            "environment", activeProfile,
            "timestamp", Instant.now().toString()
        );
    }

    @GetMapping("/health")
    @Operation(summary = "Get health status")
    public Map<String, Object> getHealth() {
        var runtime = Runtime.getRuntime();
        var memory = Map.of(
            "total", runtime.totalMemory(),
            "free", runtime.freeMemory(),
            "used", runtime.totalMemory() - runtime.freeMemory(),
            "max", runtime.maxMemory()
        );
        return Map.of(
            "status", "healthy",
            "timestamp", Instant.now().toString(),
            "uptime", ManagementFactory.getRuntimeMXBean().getUptime() / 1000.0,
            "memory", memory,
            "version", "1.0.0"
        );
    }
}
