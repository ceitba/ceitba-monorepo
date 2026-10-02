package org.ceitba.api.service.news;

import org.ceitba.api.common.exception.ResourceAlreadyExistsException;
import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.common.exception.ValidationException;
import org.ceitba.api.domain.news.UserOrganization;
import org.ceitba.api.domain.news.UserOrganizationId;
import org.ceitba.api.repository.news.OrganizationRepository;
import org.ceitba.api.repository.news.UserOrganizationRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
public class OrganizationMembershipService {

    public static final String ADMIN_ROLE = "admin";
    public static final String MEMBER_ROLE = "member";

    // V9 keeps `role` as free TEXT; this is the set the code actually acts on
    // (ADMIN_ROLE unlocks the followers list), so writes are limited to it.
    public static final List<String> ROLES = List.of(MEMBER_ROLE, ADMIN_ROLE);

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
            role != null ? requireValidRole(role) : MEMBER_ROLE));
    }

    @Transactional
    public UserOrganization updateRole(UUID userId, String orgSlug, String role) {
        String validRole = requireValidRole(role);
        var membership = repo.findById(new UserOrganizationId(userId, orgSlug))
            .orElseThrow(() -> new ResourceNotFoundException(
                "UserOrganization", userId + ":" + orgSlug));
        membership.setRole(validRole);
        return membership;
    }

    private static String requireValidRole(String role) {
        if (role == null || !ROLES.contains(role)) {
            throw new ValidationException("role", role, "must be one of " + ROLES);
        }
        return role;
    }

    @Transactional
    public void remove(UUID userId, String orgSlug) {
        repo.deleteByUserIdAndOrganization(userId, orgSlug);
    }
}
