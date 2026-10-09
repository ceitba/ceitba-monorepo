package org.ceitba.api.service.user;

import org.ceitba.api.common.exception.ResourceAlreadyExistsException;
import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.domain.User;
import org.ceitba.api.repository.CareerRepository;
import org.ceitba.api.repository.CeitbaStaffRepository;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.repository.news.UserOrganizationRepository;
import org.ceitba.api.service.news.OrganizationMembershipService;
import org.ceitba.api.web.user.dto.CreateUserRequest;
import org.ceitba.api.web.user.dto.UserResponse;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.UUID;

@Service
public class UserService {

    private final UserRepository userRepository;
    private final CareerRepository careerRepository;
    private final CeitbaStaffRepository staffRepository;
    private final UserOrganizationRepository membershipRepository;
    private final OrganizationMembershipService memberships;

    public UserService(UserRepository userRepository,
                       CareerRepository careerRepository,
                       CeitbaStaffRepository staffRepository,
                       UserOrganizationRepository membershipRepository,
                       OrganizationMembershipService memberships) {
        this.userRepository = userRepository;
        this.careerRepository = careerRepository;
        this.staffRepository = staffRepository;
        this.membershipRepository = membershipRepository;
        this.memberships = memberships;
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
            var saved = userRepository.save(user);
            // Pending org invites of this email, as on a first login (UserProvisioningService).
            memberships.claimInvites(saved.getId(), saved.getEmail());
            return toResponse(saved);
        } catch (DataIntegrityViolationException e) {
            // Race or column-level constraint we didn't pre-check
            throw new ResourceAlreadyExistsException("User", req.email());
        }
    }

    // Staff correction of a user's legajo (users enter it only once, via
    // PATCH /v1/me/profile). null clears it. FileNumberTakenException when
    // another user holds the number; the unique index backs the pre-check.
    @Transactional
    public UserResponse updateFileNumber(UUID id, Integer fileNumber) {
        var user = userRepository.findById(id)
            .orElseThrow(() -> new ResourceNotFoundException("User", id.toString()));
        if (fileNumber != null) {
            var holder = userRepository.findByFileNumber(fileNumber);
            if (holder.isPresent() && !holder.get().getId().equals(id)) {
                throw new FileNumberTakenException();
            }
        }
        user.setFileNumber(fileNumber);
        try {
            return toResponse(userRepository.saveAndFlush(user));
        } catch (DataIntegrityViolationException e) {
            throw new FileNumberTakenException();
        }
    }

    // Paginated/filtered variant for the admin Manage Users view. `q` is
    // matched against name OR email (case-insensitive substring); `organization`
    // narrows to that org's members; `sort` is the only public knob — the rest
    // (offset, limit) come from the page params. `staffOnly` keeps only users
    // with STAFF right now. The toResponse mapping stays N+1, but it's now
    // bounded by `limit` instead of the whole user table.
    @Transactional(readOnly = true)
    public Page<UserResponse> findPaged(String q, String organization, boolean staffOnly, String sort, int page, int limit) {
        // Normalize to a non-null lowercase string — see UserRepository.findFiltered
        // for why null binds blow up under Postgres + LIKE.
        String normalizedQ = (q == null) ? "" : q.trim().toLowerCase();
        String normalizedOrg = (organization == null || organization.isBlank()) ? null : organization;
        Sort jpaSort = "oldest".equalsIgnoreCase(sort)
            ? Sort.by(Sort.Direction.ASC, "createdAt")
            : Sort.by(Sort.Direction.DESC, "createdAt");
        return userRepository
            .findFiltered(normalizedQ, normalizedOrg, staffOnly, OffsetDateTime.now(),
                PageRequest.of(Math.max(page - 1, 0), Math.min(Math.max(limit, 1), 100), jpaSort))
            .map(this::toResponse);
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
