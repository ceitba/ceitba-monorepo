package org.ceitba.api.service.news;

import org.ceitba.api.common.exception.InvalidStateException;
import org.ceitba.api.common.exception.ResourceAlreadyExistsException;
import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.common.exception.ValidationException;
import org.ceitba.api.domain.User;
import org.ceitba.api.domain.news.NewsEvent;
import org.ceitba.api.repository.news.NewsEventRepository;
import org.ceitba.api.repository.news.OrganizationRepository;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.UUID;

@Service
public class NewsEventService {

    private final NewsEventRepository eventRepo;
    private final OrganizationRepository orgRepo;
    private final ApplicationEventPublisher events;
    private final OrganizationMembershipService memberships;

    public NewsEventService(NewsEventRepository eventRepo, OrganizationRepository orgRepo,
                            ApplicationEventPublisher events, OrganizationMembershipService memberships) {
        this.eventRepo   = eventRepo;
        this.orgRepo     = orgRepo;
        this.events      = events;
        this.memberships = memberships;
    }

    @Transactional(readOnly = true)
    public Page<NewsEvent> findAll(String category, String organization,
                                   LocalDate from, LocalDate to, Pageable pageable) {
        return eventRepo.findFiltered(
            category, organization,
            from != null ? from : LocalDate.of(1900, 1, 1),
            to   != null ? to   : LocalDate.of(2999, 12, 31),
            pageable
        );
    }

    @Transactional(readOnly = true)
    public NewsEvent findById(String id) {
        return eventRepo.findById(id)
            .orElseThrow(() -> new ResourceNotFoundException("Event", id));
    }

    // Cover, online link and sign-up of an event (V56). In a PATCH null leaves
    // coverImage/onlineUrl unchanged (blank clears); the sign-up is applied
    // as a whole only when signupMode is set.
    public record Extras(String coverImage, String onlineUrl, String signupMode, String signupUrl, Integer capacity) {}

    static void applyExtras(NewsEvent event, Extras x) {
        if (x == null) return;
        if (x.coverImage() != null) event.setCoverImage(blankToNull(x.coverImage()));
        if (x.onlineUrl() != null)  event.setOnlineUrl(blankToNull(x.onlineUrl()));
        if (x.signupMode() == null) return;
        var url = x.signupUrl() == null ? null : blankToNull(x.signupUrl());
        switch (x.signupMode()) {
            case NewsEvent.SIGNUP_EXTERNAL -> {
                if (url == null) throw new ValidationException("signupUrl", null, "is required for external sign-up");
                event.setSignupUrl(url);
                event.setCapacity(null);
            }
            case NewsEvent.SIGNUP_RSVP -> {
                event.setSignupUrl(null);
                event.setCapacity(x.capacity());
            }
            case NewsEvent.SIGNUP_NONE -> {
                event.setSignupUrl(null);
                event.setCapacity(null);
            }
            default -> throw new ValidationException("signupMode", x.signupMode(), "must be none, external or rsvp");
        }
        event.setSignupMode(x.signupMode());
    }

    private static String blankToNull(String s) {
        return s.isBlank() ? null : s.trim();
    }

    @Transactional
    public NewsEvent create(NewsEvent event, String organizationSlug, User createdBy) {
        return create(event, organizationSlug, createdBy, null);
    }

    @Transactional
    public NewsEvent create(NewsEvent event, String organizationSlug, User createdBy, Extras extras) {
        if (event.getId() == null || event.getId().isBlank()) {
            var e = new NewsEvent(UUID.randomUUID().toString(), event.getTitle(),
                                  event.getEventDate(), event.getStartTime(), event.getEndTime(),
                                  event.getLocation(), event.getCategory());
            e.setDescription(event.getDescription());
            event = e;
        } else if (eventRepo.existsById(event.getId())) {
            // Ids are assigned, so save() would merge over the existing row
            // (possibly another org's) instead of inserting.
            throw new ResourceAlreadyExistsException("Event", event.getId());
        }
        resolveOrganization(event, organizationSlug);
        applyExtras(event, extras);
        event.setCreatedBy(createdBy);
        var saved = eventRepo.save(event);
        // Events have no draft state: creating one publishes it, so the
        // organization's followers are notified (after commit). Edits do not.
        NewsPushes.eventPublished(saved).ifPresent(events::publishEvent);
        return saved;
    }

    @Transactional
    public NewsEvent update(String id, NewsEvent patch, String organizationSlug) {
        return update(id, patch, organizationSlug, null);
    }

    @Transactional
    public NewsEvent update(String id, NewsEvent patch, String organizationSlug, Extras extras) {
        var event = findById(id);
        applyExtras(event, extras);
        if (patch.getTitle()      != null) event.setTitle(patch.getTitle());
        if (patch.getEventDate()  != null) event.setEventDate(patch.getEventDate());
        if (patch.getStartTime()  != null) event.setStartTime(patch.getStartTime());
        if (patch.getEndTime()    != null) event.setEndTime(patch.getEndTime());
        if (patch.getLocation()   != null) event.setLocation(patch.getLocation());
        if (patch.getCategory()   != null) event.setCategory(patch.getCategory());
        if (patch.getDescription()!= null) event.setDescription(patch.getDescription());
        if (organizationSlug != null) resolveOrganization(event, organizationSlug);
        return eventRepo.save(event);
    }

    // `orgMember`: null for STAFF; otherwise the caller, who must (still,
    // under the row lock) belong to the event's organization, else 409.
    @Transactional
    public void delete(String id, UUID orgMember) {
        var event = eventRepo.findByIdForUpdate(id)
            .orElseThrow(() -> new ResourceNotFoundException("Event", id));
        if (orgMember != null && (event.getOrganization() == null
                || !memberships.userBelongsTo(orgMember, event.getOrganization().getSlug()))) {
            throw new InvalidStateException("Event " + id + " no longer belongs to one of your organizations");
        }
        eventRepo.delete(event);
    }

    private void resolveOrganization(NewsEvent event, String slug) {
        if (slug != null && !slug.isBlank()) {
            var org = orgRepo.findById(slug)
                .orElseThrow(() -> new ResourceNotFoundException("Organization", slug));
            event.setOrganization(org);
        }
    }
}
