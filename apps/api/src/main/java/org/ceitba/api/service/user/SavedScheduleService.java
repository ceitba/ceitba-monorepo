package org.ceitba.api.service.user;

import org.ceitba.api.common.exception.ResourceAlreadyExistsException;
import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.domain.SavedSchedule;
import org.ceitba.api.repository.SavedScheduleRepository;
import org.ceitba.api.web.user.dto.SaveScheduleRequest;
import org.ceitba.api.web.user.dto.SavedScheduleResponse;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
public class SavedScheduleService {

    // Hard cap to keep per-user storage bounded. Enforced at write time so
    // the error code is precise; the SPA renders X/MAX and disables Save at
    // the limit, but the server is still the authority.
    public static final int MAX_PER_USER = 5;

    private final SavedScheduleRepository repository;

    public SavedScheduleService(SavedScheduleRepository repository) {
        this.repository = repository;
    }

    @Transactional(readOnly = true)
    public List<SavedScheduleResponse> list(UUID userId) {
        return repository.findByUserIdOrderByUpdatedAtDesc(userId).stream()
            .map(this::toResponse)
            .toList();
    }

    @Transactional(readOnly = true)
    public SavedScheduleResponse get(UUID userId, UUID id) {
        var s = repository.findByIdAndUserId(id, userId)
            .orElseThrow(() -> new ResourceNotFoundException("SavedSchedule", id.toString()));
        return toResponse(s);
    }

    @Transactional
    public SavedScheduleResponse create(UUID userId, SaveScheduleRequest req) {
        if (repository.countByUserId(userId) >= MAX_PER_USER) {
            throw new ResourceAlreadyExistsException(
                "SavedSchedule",
                "Saved schedule limit reached (max " + MAX_PER_USER + "). Delete one first.");
        }
        var s = new SavedSchedule(userId, req.name(), req.payload());
        s.setCareerId(req.careerId());
        s.setPlan(req.plan());
        return toResponse(repository.save(s));
    }

    @Transactional
    public SavedScheduleResponse update(UUID userId, UUID id, SaveScheduleRequest req) {
        var s = repository.findByIdAndUserId(id, userId)
            .orElseThrow(() -> new ResourceNotFoundException("SavedSchedule", id.toString()));
        s.setName(req.name());
        s.setCareerId(req.careerId());
        s.setPlan(req.plan());
        s.setPayload(req.payload());
        return toResponse(repository.save(s));
    }

    @Transactional
    public void delete(UUID userId, UUID id) {
        var s = repository.findByIdAndUserId(id, userId)
            .orElseThrow(() -> new ResourceNotFoundException("SavedSchedule", id.toString()));
        repository.delete(s);
    }

    private SavedScheduleResponse toResponse(SavedSchedule s) {
        return new SavedScheduleResponse(
            s.getId(), s.getName(), s.getCareerId(), s.getPlan(),
            s.getPayload(), s.getCreatedAt(), s.getUpdatedAt()
        );
    }
}
