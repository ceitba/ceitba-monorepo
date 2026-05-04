package org.ceitba.api.service.news;

import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.domain.news.UserFollow;
import org.ceitba.api.repository.news.OrganizationRepository;
import org.ceitba.api.repository.news.UserFollowRepository;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
public class FollowService {

    private final UserFollowRepository repo;
    private final OrganizationRepository orgRepo;

    public FollowService(UserFollowRepository repo, OrganizationRepository orgRepo) {
        this.repo = repo;
        this.orgRepo = orgRepo;
    }

    public List<UserFollow> listForUser(UUID userId) {
        return repo.findByUserId(userId);
    }

    public boolean isFollowing(UUID userId, String orgSlug) {
        return repo.existsByUserIdAndOrganization(userId, orgSlug);
    }

    @Transactional
    public UserFollow follow(UUID userId, String orgSlug) {
        if (!orgRepo.existsById(orgSlug)) {
            throw new ResourceNotFoundException("Organization", orgSlug);
        }
        try {
            return repo.save(new UserFollow(userId, orgSlug));
        } catch (DataIntegrityViolationException race) {
            // Already following — idempotent.
            return repo.findByUserId(userId).stream()
                .filter(f -> f.getOrganization().equals(orgSlug))
                .findFirst()
                .orElseThrow(() -> race);
        }
    }

    // Used by the JIT user-provisioning path. Guards every failure mode so
    // it can be invoked from inside another transaction without ever marking
    // the outer one rollback-only:
    //   * missing org → silently skip (test envs without the ceitba seed)
    //   * already following → silently skip (idempotent)
    @Transactional
    public void followIfMissing(UUID userId, String orgSlug) {
        if (!orgRepo.existsById(orgSlug)) return;
        if (repo.existsByUserIdAndOrganization(userId, orgSlug)) return;
        repo.save(new UserFollow(userId, orgSlug));
    }

    @Transactional
    public void unfollow(UUID userId, String orgSlug) {
        repo.deleteByUserIdAndOrganization(userId, orgSlug);
    }
}
