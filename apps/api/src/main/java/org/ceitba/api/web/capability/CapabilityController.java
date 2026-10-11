package org.ceitba.api.web.capability;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.ceitba.api.service.capability.CapabilityService;
import org.ceitba.api.web.capability.dto.PublicCapabilitiesResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

// Public read of the capabilities switched on for everyone (docs/CAPABILITIES.md),
// so the web app can show those features to visitors who haven't signed in.
@Tag(name = "Capabilities")
@RestController
@RequestMapping("/v1/capabilities")
public class CapabilityController {

    private final CapabilityService service;

    public CapabilityController(CapabilityService service) {
        this.service = service;
    }

    @GetMapping
    @Operation(summary = "Capability keys enabled for every user (public)")
    public PublicCapabilitiesResponse enabledForAll() {
        return new PublicCapabilitiesResponse(List.copyOf(service.enabledForAll()));
    }
}
