package org.ceitba.api.service.news;

import org.ceitba.api.common.exception.ResourceAlreadyExistsException;
import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.domain.news.Organization;
import org.ceitba.api.repository.news.OrganizationRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class OrganizationService {

    private final OrganizationRepository repo;

    public OrganizationService(OrganizationRepository repo) {
        this.repo = repo;
    }

    public List<Organization> findAll() {
        return repo.findAll();
    }

    public Organization findBySlug(String slug) {
        return repo.findById(slug)
            .orElseThrow(() -> new ResourceNotFoundException("Organization", slug));
    }

    @Transactional
    public Organization create(Organization org) {
        if (repo.existsById(org.getSlug())) {
            throw new ResourceAlreadyExistsException("Organization", org.getSlug());
        }
        return repo.save(org);
    }

    @Transactional
    public Organization update(String slug, Organization patch) {
        var org = findBySlug(slug);
        if (patch.getName()        != null) org.setName(patch.getName());
        if (patch.getFullName()    != null) org.setFullName(patch.getFullName());
        if (patch.getDescription() != null) org.setDescription(patch.getDescription());
        if (patch.getCategory()    != null) org.setCategory(patch.getCategory());
        if (patch.getColor()       != null) org.setColor(patch.getColor());
        org.setMemberCount(patch.getMemberCount() > 0 ? patch.getMemberCount() : org.getMemberCount());
        return repo.save(org);
    }

    @Transactional
    public void delete(String slug) {
        if (!repo.existsById(slug)) {
            throw new ResourceNotFoundException("Organization", slug);
        }
        repo.deleteById(slug);
    }
}
