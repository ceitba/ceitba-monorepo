package org.ceitba.api.service.user;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import org.ceitba.api.common.exception.ResourceAlreadyExistsException;
import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.domain.SavedSchedule;
import org.ceitba.api.repository.SavedScheduleRepository;
import org.ceitba.api.web.user.dto.SaveScheduleRequest;
import org.ceitba.api.web.user.dto.SavedScheduleResponse;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class SavedScheduleService {

    // Hard cap to keep per-user storage bounded. Enforced at write time so
    // the error code is precise; the SPA renders X/MAX and disables Save at
    // the limit, but the server is still the authority.
    public static final int MAX_PER_USER = 5;

    private static final ObjectMapper CANONICAL = new ObjectMapper()
        .configure(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS, true);

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
        // Count, cap and first-is-primary must see the user's other writes.
        repository.lockUserSchedules(userId);
        long existing = repository.countByUserId(userId);
        if (existing >= MAX_PER_USER) {
            throw new ResourceAlreadyExistsException(
                "SavedSchedule",
                "Saved schedule limit reached (max " + MAX_PER_USER + "). Delete one first.");
        }
        var s = new SavedSchedule(userId, req.name(), req.payload());
        s.setCareerId(req.careerId());
        s.setPlan(req.plan());
        // The first schedule a user saves becomes primary. Later creates never
        // touch the primary flag, even when the user currently has none.
        s.setPrimary(existing == 0);
        return toResponse(repository.save(s));
    }

    // Makes `id` the user's primary schedule, clearing the previous one.
    // Idempotent. Deleting the primary does not promote another: the client
    // picks the next one explicitly through this method.
    @Transactional
    public SavedScheduleResponse makePrimary(UUID userId, UUID id) {
        repository.lockUserSchedules(userId);
        repository.findByIdAndUserId(id, userId)
            .orElseThrow(() -> new ResourceNotFoundException("SavedSchedule", id.toString()));
        repository.clearPrimaryExcept(userId, id);
        // Re-read: the bulk update cleared the persistence context.
        var s = repository.findByIdAndUserId(id, userId)
            .orElseThrow(() -> new ResourceNotFoundException("SavedSchedule", id.toString()));
        s.setPrimary(true);
        return toResponse(repository.saveAndFlush(s));
    }

    @Transactional
    public SavedScheduleResponse update(UUID userId, UUID id, SaveScheduleRequest req) {
        var s = repository.findByIdAndUserId(id, userId)
            .orElseThrow(() -> new ResourceNotFoundException("SavedSchedule", id.toString()));
        s.setName(req.name());
        s.setCareerId(req.careerId());
        s.setPlan(req.plan());
        // Only a real payload change moves payload_updated_at (renames and
        // toggles must not make an old term's schedule look current).
        if (payloadChanged(s.getPayload(), req.payload())) {
            s.setPayloadUpdatedAt(OffsetDateTime.now());
        }
        s.setPayload(req.payload());
        return toResponse(repository.save(s));
    }

    @Transactional
    public void delete(UUID userId, UUID id) {
        var s = repository.findByIdAndUserId(id, userId)
            .orElseThrow(() -> new ResourceNotFoundException("SavedSchedule", id.toString()));
        repository.delete(s);
    }

    // Compared as canonical JSON (sorted keys), so Integer/Long and key order
    // differences between the stored and the incoming map are not changes.
    static boolean payloadChanged(Map<String, Object> stored, Map<String, Object> incoming) {
        return !canonical(stored).equals(canonical(incoming));
    }

    private static String canonical(Map<String, Object> payload) {
        try {
            return CANONICAL.writeValueAsString(payload == null ? Map.of() : payload);
        } catch (JsonProcessingException e) {
            // Not serializable (cannot happen for a JSON payload): count it as changed.
            return "?" + System.identityHashCode(payload);
        }
    }

    private SavedScheduleResponse toResponse(SavedSchedule s) {
        return new SavedScheduleResponse(
            s.getId(), s.getName(), s.getCareerId(), s.getPlan(),
            s.getPayload(), s.isPrimary(), s.getCreatedAt(), s.getUpdatedAt()
        );
    }
}
