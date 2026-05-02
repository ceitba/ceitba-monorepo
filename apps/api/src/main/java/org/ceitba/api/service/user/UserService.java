package org.ceitba.api.service.user;

import org.ceitba.api.common.exception.ResourceAlreadyExistsException;
import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.domain.User;
import org.ceitba.api.repository.CareerRepository;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.web.user.dto.CreateUserRequest;
import org.ceitba.api.web.user.dto.UserResponse;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
public class UserService {

    private final UserRepository userRepository;
    private final CareerRepository careerRepository;

    public UserService(UserRepository userRepository, CareerRepository careerRepository) {
        this.userRepository = userRepository;
        this.careerRepository = careerRepository;
    }

    @Transactional
    public UserResponse create(CreateUserRequest req) {
        if (userRepository.findByEmail(req.email()).isPresent()) {
            throw new ResourceAlreadyExistsException("User", req.email());
        }

        var user = new User(UUID.randomUUID(), req.email(), req.name());
        user.setFileNumber(req.fileNumber());
        user.setPlan(req.plan());
        if (req.careerId() != null) {
            // Validate FK eagerly so the response is a 404 with a clean message,
            // not a 409 from the DB constraint.
            var career = careerRepository.findById(req.careerId())
                .orElseThrow(() -> new ResourceNotFoundException("Career", req.careerId()));
            user.setCareer(career);
        }

        try {
            return toResponse(userRepository.save(user));
        } catch (DataIntegrityViolationException e) {
            // Race or column-level constraint we didn't pre-check
            throw new ResourceAlreadyExistsException("User", req.email());
        }
    }

    @Transactional(readOnly = true)
    public List<UserResponse> getAll() {
        return userRepository.findAll().stream().map(this::toResponse).toList();
    }

    @Transactional(readOnly = true)
    public UserResponse getById(UUID id) {
        var user = userRepository.findById(id)
            .orElseThrow(() -> new ResourceNotFoundException("User", id.toString()));
        return toResponse(user);
    }

    private UserResponse toResponse(User u) {
        return new UserResponse(
            u.getId(),
            u.getEmail(),
            u.getName(),
            u.getFileNumber(),
            u.getCareer() != null ? u.getCareer().getId() : null,
            u.getPlan()
        );
    }
}
