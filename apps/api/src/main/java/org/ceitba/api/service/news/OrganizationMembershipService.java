package org.ceitba.api.service.news;

import org.ceitba.api.common.exception.ResourceAlreadyExistsException;
import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.domain.news.UserOrganization;
import org.ceitba.api.repository.news.OrganizationRepository;
import org.ceitba.api.repository.news.UserOrganizationRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
public class OrganizationMembershipService {

    public static final String ADMIN_ROLE = "admin";

    private final UserOrganizationRepository repo;
    private final OrganizationRepository orgRepo;

    public OrganizationMembershipService(UserOrganizationRepository repo,
                                          OrganizationRepository orgRepo) {
        this.repo = repo;
        this.orgRepo = orgRepo;
    }

    public List<UserOrganization> listForUser(UUID userId) {
        return repo.findByUserId(userId);
    }

    public boolean userBelongsTo(UUID userId, String orgSlug) {
        if (userId == null || orgSlug == null) return false;
        return repo.existsByUserIdAndOrganization(userId, orgSlug);
    }

    @Transactional(readOnly = true)
    public boolean userIsAdminOf(UUID userId, String orgSlug) {
        if (userId == null || orgSlug == null) return false;
        return repo.existsByUserIdAndOrganizationAndRole(userId, orgSlug, ADMIN_ROLE);
    }

    @Transactional
    public UserOrganization add(UUID userId, String orgSlug, String role) {
        if (!orgRepo.existsById(orgSlug)) {
            throw new ResourceNotFoundException("Organization", orgSlug);
        }
        if (repo.existsByUserIdAndOrganization(userId, orgSlug)) {
            throw new ResourceAlreadyExistsException(
                "UserOrganization", userId + ":" + orgSlug);
        }
        return repo.save(new UserOrganization(userId, orgSlug,
            role != null ? role : "member"));
    }

    @Transactional
    public void remove(UUID userId, String orgSlug) {
        repo.deleteByUserIdAndOrganization(userId, orgSlug);
    }
}
