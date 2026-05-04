package org.ceitba.api.web.news;

import jakarta.validation.Valid;
import org.ceitba.api.domain.User;
import org.ceitba.api.domain.news.NewsEvent;
import org.ceitba.api.service.news.NewsEventService;
import org.ceitba.api.web.auth.CurrentUser;
import org.ceitba.api.web.news.dto.NewsEventInput;
import org.ceitba.api.web.news.dto.NewsEventPatchInput;
import org.ceitba.api.web.news.dto.NewsEventResponse;
import org.ceitba.api.web.news.dto.PageResponse;
import org.springframework.data.domain.PageRequest;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;

@RestController
@RequestMapping("/v1/news/events")
public class NewsEventController {

    private final NewsEventService service;

    public NewsEventController(NewsEventService service) {
        this.service = service;
    }

    @GetMapping
    public PageResponse<NewsEventResponse> list(
            @RequestParam(required = false) String category,
            @RequestParam(required = false) String organization,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "50") int limit) {

        var result = service.findAll(category, organization, from, to,
                                     PageRequest.of(Math.max(page - 1, 0), limit));
        return new PageResponse<>(
            result.getContent().stream().map(NewsEventResponse::from).toList(),
            new PageResponse.Meta(result.getTotalElements(), page, limit)
        );
    }

    @GetMapping("/{id}")
    public NewsEventResponse get(@PathVariable String id) {
        return NewsEventResponse.from(service.findById(id));
    }

    @PostMapping
    @PreAuthorize("hasRole('STAFF') or @orgAccess.canWriteForOrg(#req.organization(), authentication)")
    public ResponseEntity<NewsEventResponse> create(@RequestBody @Valid NewsEventInput req,
                                                     @CurrentUser User user) {
        var event = new NewsEvent(req.id(), req.title(), req.eventDate(),
                                  req.startTime(), req.endTime(), req.location(), req.category());
        event.setDescription(req.description());
        return ResponseEntity.status(HttpStatus.CREATED)
            .body(NewsEventResponse.from(service.create(event, req.organization(), user)));
    }

    @PatchMapping("/{id}")
    @PreAuthorize("hasRole('STAFF') or @orgAccess.canWriteForEvent(#id, #req.organization(), authentication)")
    public NewsEventResponse patch(@PathVariable String id,
                                    @RequestBody NewsEventPatchInput req) {
        var patch = new NewsEvent(id, null, null, null, null, null, null);
        if (req.title()       != null) patch.setTitle(req.title());
        if (req.eventDate()   != null) patch.setEventDate(req.eventDate());
        if (req.startTime()   != null) patch.setStartTime(req.startTime());
        if (req.endTime()     != null) patch.setEndTime(req.endTime());
        if (req.location()    != null) patch.setLocation(req.location());
        if (req.category()    != null) patch.setCategory(req.category());
        if (req.description() != null) patch.setDescription(req.description());
        return NewsEventResponse.from(service.update(id, patch, req.organization()));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasRole('STAFF')")
    public ResponseEntity<Void> delete(@PathVariable String id) {
        service.delete(id);
        return ResponseEntity.noContent().build();
    }
}
