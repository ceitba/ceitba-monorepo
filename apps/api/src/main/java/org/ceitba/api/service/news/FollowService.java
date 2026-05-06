package org.ceitba.api.service.news;

import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.domain.User;
import org.ceitba.api.domain.news.UserFollow;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.repository.news.OrganizationRepository;
import org.ceitba.api.repository.news.UserFollowRepository;
import org.ceitba.api.web.news.dto.FollowerResponse;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
public class FollowService {

    private final UserFollowRepository repo;
    private final OrganizationRepository orgRepo;
    private final UserRepository userRepo;

    public FollowService(UserFollowRepository repo,
                         OrganizationRepository orgRepo,
                         UserRepository userRepo) {
        this.repo = repo;
        this.orgRepo = orgRepo;
        this.userRepo = userRepo;
    }

    public List<UserFollow> listForUser(UUID userId) {
        return repo.findByUserId(userId);
    }

    // Returns followers of an org (newest first), enriched with user fields
    // for the admin panel. Throws if the org doesn't exist so the caller can
    // surface a 404 instead of an empty list (which would mask typos).
    public List<FollowerResponse> listFollowers(String orgSlug) {
        if (!orgRepo.existsById(orgSlug)) {
            throw new ResourceNotFoundException("Organization", orgSlug);
        }
        List<UserFollow> follows = repo.findByOrganizationOrderByCreatedAtDesc(orgSlug);
        if (follows.isEmpty()) return List.of();

        Map<UUID, User> users = userRepo.findAllById(
            follows.stream().map(UserFollow::getUserId).toList()
        ).stream().collect(Collectors.toMap(User::getId, Function.identity()));

        return follows.stream()
            .map(f -> {
                User u = users.get(f.getUserId());
                return new FollowerResponse(
                    f.getUserId(),
                    u != null ? u.getName() : null,
                    u != null ? u.getEmail() : null,
                    u != null ? u.getAvatarUrl() : null,
                    f.getCreatedAt()
                );
            })
            .toList();
    }

    public long countFollowers(String orgSlug) {
        return repo.countByOrganization(orgSlug);
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
