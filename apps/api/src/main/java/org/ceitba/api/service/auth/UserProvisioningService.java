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
    public User findOrCreate(String email, String name) {
        return userRepository.findByEmail(email).orElseGet(() -> {
            try {
                return userRepository.save(new User(UUID.randomUUID(), email, name));
            } catch (DataIntegrityViolationException race) {
                // Concurrent create — re-read.
                return userRepository.findByEmail(email).orElseThrow(() -> race);
            }
        });
    }
}
