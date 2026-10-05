package org.ceitba.api.web.kb.admin;

import com.fasterxml.jackson.databind.JsonNode;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.ceitba.api.domain.User;
import org.ceitba.api.service.kb.admin.KbEndpointService;
import org.ceitba.api.web.auth.CurrentUser;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

// Custom OpenAI-compatible LLM endpoints for the wiki pipeline (own GPU server).
@Tag(name = "Subject wikis - admin")
@RestController
@RequestMapping("/v1/staff/kb/endpoints")
@PreAuthorize("hasRole('STAFF')")
@SecurityRequirement(name = "bearerAuth")
public class StaffKbEndpointController {

    private final KbEndpointService endpoints;

    public StaffKbEndpointController(KbEndpointService endpoints) {
        this.endpoints = endpoints;
    }

    @GetMapping
    @Operation(summary = "Custom endpoints (the API key is never returned: hasKey / keyReadable)")
    public List<KbEndpointDtos.Item> list() {
        return endpoints.list();
    }

    @PostMapping
    @Operation(summary = "Add an endpoint {name, baseUrl, apiKey?, maxConcurrency?, timeoutSec?, enabled?}")
    public KbEndpointDtos.Item create(@CurrentUser User user, @RequestBody JsonNode body) {
        return endpoints.create(user.getId(), body);
    }

    @PutMapping("/{id}")
    @Operation(summary = "Edit an endpoint; apiKey omitted keeps the key, \"\" removes it")
    public KbEndpointDtos.Item update(@CurrentUser User user, @PathVariable UUID id, @RequestBody JsonNode body) {
        return endpoints.update(user.getId(), id, body);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "Delete an endpoint and its catalog models; 409 KB_ENDPOINT_IN_USE while settings or an active run use one")
    public void delete(@PathVariable UUID id) {
        endpoints.delete(id);
    }

    @PostMapping("/{id}/test")
    @Operation(summary = "GET {baseUrl}/models with latency")
    public KbEndpointDtos.TestResult test(@PathVariable UUID id) {
        return endpoints.test(id);
    }

    @PostMapping("/{id}/discover")
    @Operation(summary = "Add the endpoint's models to the catalog as custom/<name>/<model> (disabled, price 0)")
    public KbEndpointDtos.DiscoverResult discover(@PathVariable UUID id) {
        return endpoints.discover(id);
    }

    @GetMapping("/{id}/stats")
    @Operation(summary = "Requests, errors, p50/p95 latency, output tok/s and in-flight calls in the last N minutes")
    public KbEndpointDtos.Stats stats(@PathVariable UUID id, @RequestParam(defaultValue = "60") int minutes) {
        return endpoints.stats(id, minutes);
    }
}
