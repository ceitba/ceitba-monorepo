package org.ceitba.api.service.auth;

import org.ceitba.api.domain.User;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.service.news.FollowService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

// Just-in-time user provisioning. The first time a Google ID token arrives
// for a never-seen email, we create a User row from the (email, name)
// claims. Subsequent calls return the existing row.
@Service
public class UserProvisioningService {

    private static final Logger log = LoggerFactory.getLogger(UserProvisioningService.class);

    private final UserRepository userRepository;
    // Optional injection: in test contexts where the FollowService bean
    // isn't loaded (or the ceitba org isn't seeded) we silently skip the
    // auto-follow — login must never fail because of newsletter wiring.
    private final FollowService followService;

    @Autowired
    public UserProvisioningService(UserRepository userRepository,
                                    FollowService followService) {
        this.userRepository = userRepository;
        this.followService = followService;
    }

    // REQUIRES_NEW so this commits even if the calling controller fails;
    // the next request shouldn't have to re-provision.
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public User findOrCreate(String email, String name, String googleSub, String avatarUrl) {
        return userRepository.findByEmail(email)
            .map(existing -> syncProfile(existing, name, googleSub, avatarUrl))
            .orElseGet(() -> {
                try {
                    var u = new User(UUID.randomUUID(), email, name);
                    u.setGoogleSub(googleSub);
                    u.setAvatarUrl(avatarUrl);
                    var saved = userRepository.save(u);
                    autoFollowCeitba(saved.getId());
                    return saved;
                } catch (DataIntegrityViolationException race) {
                    return userRepository.findByEmail(email).orElseThrow(() -> race);
                }
            });
    }

    private void autoFollowCeitba(UUID userId) {
        try {
            followService.followIfMissing(userId, "ceitba");
        } catch (Exception e) {
            log.warn("Auto-follow CEITBA failed for user {}: {}", userId, e.getMessage());
        }
    }

    private User syncProfile(User user, String name, String googleSub, String avatarUrl) {
        boolean dirty = false;
        if (name != null && !name.equals(user.getName())) {
            user.setName(name);
            dirty = true;
        }
        if (googleSub != null && !googleSub.equals(user.getGoogleSub())) {
            user.setGoogleSub(googleSub);
            dirty = true;
        }
        if (avatarUrl != null && !avatarUrl.equals(user.getAvatarUrl())) {
            user.setAvatarUrl(avatarUrl);
            dirty = true;
        }
        return dirty ? userRepository.save(user) : user;
    }
}
