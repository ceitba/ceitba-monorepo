package org.ceitba.api.web.news;

import jakarta.validation.Valid;
import org.ceitba.api.domain.User;
import org.ceitba.api.domain.news.NewsEvent;
import org.ceitba.api.service.news.EventRsvpService;
import org.ceitba.api.service.news.NewsEventService;
import org.ceitba.api.web.auth.CurrentUser;
import org.ceitba.api.web.news.dto.NewsEventInput;
import org.ceitba.api.web.news.dto.NewsEventPatchInput;
import org.ceitba.api.web.news.dto.NewsEventResponse;
import org.ceitba.api.web.news.dto.PageResponse;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
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
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/v1/news/events")
public class NewsEventController {

    private final NewsEventService service;
    private final EventRsvpService rsvps;

    public NewsEventController(NewsEventService service, EventRsvpService rsvps) {
        this.service = service;
        this.rsvps = rsvps;
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
                                     NewsPaging.of(page, limit));
        var counts = rsvps.counts(result.getContent().stream().map(NewsEvent::getId).toList());
        return new PageResponse<>(
            result.getContent().stream().map(e -> NewsEventResponse.from(e, counts.getOrDefault(e.getId(), 0L))).toList(),
            PageResponse.Meta.of(result)
        );
    }

    @GetMapping("/{id}")
    public NewsEventResponse get(@PathVariable String id) {
        return withCount(service.findById(id));
    }

    @PostMapping
    @PreAuthorize("hasRole('STAFF') or @orgAccess.canWriteForOrg(#req.organization(), authentication)")
    public ResponseEntity<NewsEventResponse> create(@RequestBody @Valid NewsEventInput req,
                                                     @CurrentUser User user) {
        var event = new NewsEvent(req.id(), req.title(), req.eventDate(),
                                  req.startTime(), req.endTime(), req.location(), req.category());
        event.setDescription(req.description());
        var extras = new NewsEventService.Extras(req.coverImage(), req.onlineUrl(),
            req.signupMode() != null ? req.signupMode() : NewsEvent.SIGNUP_NONE, req.signupUrl(), req.capacity());
        return ResponseEntity.status(HttpStatus.CREATED)
            .body(NewsEventResponse.from(service.create(event, req.organization(), user, extras)));
    }

    @PatchMapping("/{id}")
    @PreAuthorize("hasRole('STAFF') or @orgAccess.canWriteForEvent(#id, #req.organization(), authentication)")
    public NewsEventResponse patch(@PathVariable String id,
                                    @RequestBody @Valid NewsEventPatchInput req) {
        var patch = new NewsEvent(id, null, null, null, null, null, null);
        if (req.title()       != null) patch.setTitle(req.title());
        if (req.eventDate()   != null) patch.setEventDate(req.eventDate());
        if (req.startTime()   != null) patch.setStartTime(req.startTime());
        if (req.endTime()     != null) patch.setEndTime(req.endTime());
        if (req.location()    != null) patch.setLocation(req.location());
        if (req.category()    != null) patch.setCategory(req.category());
        if (req.description() != null) patch.setDescription(req.description());
        var extras = new NewsEventService.Extras(req.coverImage(), req.onlineUrl(), req.signupMode(),
            req.signupUrl(), req.capacity());
        return withCount(service.update(id, patch, req.organization(), extras));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasRole('STAFF') or @orgAccess.canDeleteEvent(#id, authentication)")
    public ResponseEntity<Void> delete(@PathVariable String id, @CurrentUser User user, Authentication auth) {
        boolean staff = auth.getAuthorities().stream().anyMatch(a -> "ROLE_STAFF".equals(a.getAuthority()));
        service.delete(id, staff ? null : user.getId());
        return ResponseEntity.noContent().build();
    }

    // Built-in sign-up (signupMode 'rsvp'): any signed-in user. 409
    // EventNotRsvp / EventEnded / EventFull; both are idempotent.
    @PostMapping("/{id}/rsvp")
    public RsvpResponse rsvp(@PathVariable String id, @CurrentUser User user) {
        return new RsvpResponse(true, rsvps.rsvp(id, user.getId()));
    }

    @DeleteMapping("/{id}/rsvp")
    public RsvpResponse cancelRsvp(@PathVariable String id, @CurrentUser User user) {
        return new RsvpResponse(false, rsvps.cancel(id, user.getId()));
    }

    // Who is going, with emails: members of the event's organization and STAFF.
    @GetMapping("/{id}/attendees")
    @PreAuthorize("hasRole('STAFF') or @orgAccess.canSeeAttendees(#id, authentication)")
    public Map<String, List<EventRsvpService.Attendee>> attendees(@PathVariable String id) {
        return Map.of("data", rsvps.attendees(id));
    }

    private NewsEventResponse withCount(NewsEvent e) {
        return NewsEventResponse.from(e, rsvps.counts(List.of(e.getId())).getOrDefault(e.getId(), 0L));
    }

    public record RsvpResponse(boolean going, long rsvpCount) {}
}
