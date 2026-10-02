package org.ceitba.api.service.staff;

import org.ceitba.api.common.exception.ResourceAlreadyExistsException;
import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.common.exception.ValidationException;
import org.ceitba.api.domain.CeitbaStaff;
import org.ceitba.api.repository.CeitbaStaffRepository;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.web.staff.dto.AssignStaffRequest;
import org.ceitba.api.web.staff.dto.StaffResponse;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

@Service
public class StaffService {

    private final UserRepository userRepository;
    private final CeitbaStaffRepository staffRepository;

    public StaffService(UserRepository userRepository, CeitbaStaffRepository staffRepository) {
        this.userRepository = userRepository;
        this.staffRepository = staffRepository;
    }

    @Transactional(readOnly = true)
    public List<StaffResponse> listActive() {
        return staffRepository.findAllActive(OffsetDateTime.now()).stream()
            .map(this::toResponse)
            .toList();
    }

    @Transactional
    public StaffResponse assign(AssignStaffRequest req) {
        if (!req.start().isBefore(req.end())) {
            throw new ValidationException("start", req.start(), "must be before end");
        }
        var user = userRepository.findByEmail(req.email())
            .orElseThrow(() -> new ResourceNotFoundException("User", req.email()));

        // CeitbaStaff PK is user_id — one staff record per user. Only a currently
        // active membership conflicts; an expired (revoked) or not-yet-started row
        // is replaced so revoke → re-assign works.
        var now = OffsetDateTime.now();
        var existing = staffRepository.findById(user.getId());
        if (existing.isPresent()) {
            if (staffRepository.isActiveStaff(user.getId(), now)) {
                throw new ResourceAlreadyExistsException("CeitbaStaff", req.email());
            }
            staffRepository.delete(existing.get());
            staffRepository.flush();
        }

        var saved = staffRepository.save(
            new CeitbaStaff(user, req.branch(), req.role(), req.start(), req.end()));
        return toResponse(saved);
    }

    // "Revoke" = end-date the membership at `now`. Keeps the row for audit so
    // future "who was staff between dates X and Y" queries still work. Only
    // hard-delete a record that hasn't started yet (mistakes).
    @Transactional
    public void revoke(UUID userId) {
        var staff = staffRepository.findById(userId)
            .orElseThrow(() -> new ResourceNotFoundException("CeitbaStaff", userId.toString()));
        var now = OffsetDateTime.now();
        if (staff.getStart().isAfter(now)) {
            staffRepository.delete(staff);
            return;
        }
        // CeitbaStaff fields are mostly immutable in the entity by design.
        // Use a native update to push the end forward without rebuilding the row.
        staffRepository.delete(staff);
        var rewritten = new CeitbaStaff(staff.getUser(), staff.getBranch(), staff.getRole(),
            staff.getStart(), now);
        staffRepository.save(rewritten);
    }

    private StaffResponse toResponse(CeitbaStaff s) {
        return new StaffResponse(
            s.getUserId(),
            s.getUser().getEmail(),
            s.getUser().getName(),
            s.getBranch(),
            s.getRole(),
            s.getStart(),
            s.getEnd()
        );
    }
}
