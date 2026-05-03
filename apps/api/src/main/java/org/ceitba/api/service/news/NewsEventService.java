package org.ceitba.api.service.news;

import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.domain.User;
import org.ceitba.api.domain.news.NewsEvent;
import org.ceitba.api.repository.news.NewsEventRepository;
import org.ceitba.api.repository.news.OrganizationRepository;
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

    public NewsEventService(NewsEventRepository eventRepo, OrganizationRepository orgRepo) {
        this.eventRepo = eventRepo;
        this.orgRepo   = orgRepo;
    }

    public Page<NewsEvent> findAll(String category, String organization,
                                   LocalDate from, LocalDate to, Pageable pageable) {
        return eventRepo.findFiltered(
            category, organization,
            from != null ? from : LocalDate.of(1900, 1, 1),
            to   != null ? to   : LocalDate.of(2999, 12, 31),
            pageable
        );
    }

    public NewsEvent findById(String id) {
        return eventRepo.findById(id)
            .orElseThrow(() -> new ResourceNotFoundException("Event", id));
    }

    @Transactional
    public NewsEvent create(NewsEvent event, String organizationSlug, User createdBy) {
        if (event.getId() == null || event.getId().isBlank()) {
            var e = new NewsEvent(UUID.randomUUID().toString(), event.getTitle(),
                                  event.getEventDate(), event.getStartTime(), event.getEndTime(),
                                  event.getLocation(), event.getCategory());
            e.setDescription(event.getDescription());
            event = e;
        }
        resolveOrganization(event, organizationSlug);
        event.setCreatedBy(createdBy);
        return eventRepo.save(event);
    }

    @Transactional
    public NewsEvent update(String id, NewsEvent patch, String organizationSlug) {
        var event = findById(id);
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

    @Transactional
    public void delete(String id) {
        if (!eventRepo.existsById(id)) {
            throw new ResourceNotFoundException("Event", id);
        }
        eventRepo.deleteById(id);
    }

    private void resolveOrganization(NewsEvent event, String slug) {
        if (slug != null && !slug.isBlank()) {
            var org = orgRepo.findById(slug)
                .orElseThrow(() -> new ResourceNotFoundException("Organization", slug));
            event.setOrganization(org);
        }
    }
}
