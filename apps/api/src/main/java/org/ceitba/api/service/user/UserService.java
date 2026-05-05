package org.ceitba.api.service.user;

import org.ceitba.api.common.exception.ResourceAlreadyExistsException;
import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.domain.User;
import org.ceitba.api.repository.CareerRepository;
import org.ceitba.api.repository.CeitbaStaffRepository;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.repository.news.UserOrganizationRepository;
import org.ceitba.api.web.user.dto.CreateUserRequest;
import org.ceitba.api.web.user.dto.UserResponse;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

@Service
public class UserService {

    private final UserRepository userRepository;
    private final CareerRepository careerRepository;
    private final CeitbaStaffRepository staffRepository;
    private final UserOrganizationRepository membershipRepository;

    public UserService(UserRepository userRepository,
                       CareerRepository careerRepository,
                       CeitbaStaffRepository staffRepository,
                       UserOrganizationRepository membershipRepository) {
        this.userRepository = userRepository;
        this.careerRepository = careerRepository;
        this.staffRepository = staffRepository;
        this.membershipRepository = membershipRepository;
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
        // N+1 across staff + memberships is fine for the admin user list:
        // it's gated by ROLE_STAFF, called rarely, and the user table is small.
        return userRepository.findAll().stream().map(this::toResponse).toList();
    }

    @Transactional(readOnly = true)
    public UserResponse getById(UUID id) {
        var user = userRepository.findById(id)
            .orElseThrow(() -> new ResourceNotFoundException("User", id.toString()));
        return toResponse(user);
    }

    private UserResponse toResponse(User u) {
        var memberships = membershipRepository.findByUserId(u.getId()).stream()
            .map(m -> new UserResponse.Membership(m.getOrganization(), m.getRole()))
            .toList();
        boolean isStaff = staffRepository.isActiveStaff(u.getId(), OffsetDateTime.now());
        return new UserResponse(
            u.getId(),
            u.getEmail(),
            u.getName(),
            u.getFileNumber(),
            u.getCareer() != null ? u.getCareer().getId() : null,
            u.getPlan(),
            u.getAvatarUrl(),
            isStaff,
            memberships
        );
    }
}
