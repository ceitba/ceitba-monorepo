package org.ceitba.api.service.auth;

import org.ceitba.api.domain.User;
import org.ceitba.api.repository.UserRepository;
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

    private final UserRepository userRepository;

    public UserProvisioningService(UserRepository userRepository) {
        this.userRepository = userRepository;
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
                    return userRepository.save(u);
                } catch (DataIntegrityViolationException race) {
                    return userRepository.findByEmail(email).orElseThrow(() -> race);
                }
            });
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
