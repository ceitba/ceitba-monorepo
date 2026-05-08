package org.ceitba.api.service.share;

import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.common.exception.ValidationException;
import org.ceitba.api.domain.SavedSchedule;
import org.ceitba.api.domain.ShareSession;
import org.ceitba.api.domain.ShareSessionParticipant;
import org.ceitba.api.domain.User;
import org.ceitba.api.repository.SavedScheduleRepository;
import org.ceitba.api.repository.ShareSessionParticipantRepository;
import org.ceitba.api.repository.ShareSessionRepository;
import org.ceitba.api.web.share.dto.CreateShareSessionRequest;
import org.ceitba.api.web.share.dto.JoinShareSessionRequest;
import org.ceitba.api.web.share.dto.ParticipantResponse;
import org.ceitba.api.web.share.dto.ShareSessionResponse;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class ShareSessionService {

    // Soft cap on participants per session. Heatmap rendering and the public
    // viewer payload size both degrade past this point; well above expected
    // use (study group of 5–15 friends).
    public static final int MAX_PARTICIPANTS = 50;

    private static final SecureRandom RNG = new SecureRandom();
    // 12 random bytes -> 16 base64url characters, ~96 bits of entropy.
    private static final int TOKEN_BYTES = 12;
    private static final int TOKEN_RETRIES = 5;

    private final ShareSessionRepository sessions;
    private final ShareSessionParticipantRepository participants;
    private final SavedScheduleRepository savedSchedules;

    public ShareSessionService(ShareSessionRepository sessions,
                               ShareSessionParticipantRepository participants,
                               SavedScheduleRepository savedSchedules) {
        this.sessions = sessions;
        this.participants = participants;
        this.savedSchedules = savedSchedules;
    }

    @Transactional
    public ShareSessionResponse create(User creator, CreateShareSessionRequest req) {
        SavedSchedule anchor = savedSchedules.findByIdAndUserId(req.savedScheduleId(), creator.getId())
            .orElseThrow(() -> new ResourceNotFoundException("SavedSchedule", req.savedScheduleId().toString()));

        ShareSession session = new ShareSession(generateUniqueToken(), creator.getId(), req.name());
        session = sessions.save(session);

        String displayName = resolveDisplayName(req.displayName(), creator);
        participants.save(new ShareSessionParticipant(
            session.getId(), creator.getId(), anchor.getId(), displayName));

        return readByToken(session.getToken());
    }

    @Transactional(readOnly = true)
    public ShareSessionResponse readByToken(String token) {
        ShareSession session = sessions.findByToken(token)
            .orElseThrow(() -> new ResourceNotFoundException("ShareSession", token));
        return toResponse(session);
    }

    @Transactional
    public ShareSessionResponse join(User user, String token, JoinShareSessionRequest req) {
        ShareSession session = sessions.findByToken(token)
            .orElseThrow(() -> new ResourceNotFoundException("ShareSession", token));

        SavedSchedule schedule = savedSchedules.findByIdAndUserId(req.savedScheduleId(), user.getId())
            .orElseThrow(() -> new ResourceNotFoundException("SavedSchedule", req.savedScheduleId().toString()));

        boolean alreadyJoined = participants.findBySessionIdOrderByJoinedAtAsc(session.getId())
            .stream().anyMatch(p -> p.getUserId().equals(user.getId()));

        if (!alreadyJoined && participants.countBySessionId(session.getId()) >= MAX_PARTICIPANTS) {
            throw new ValidationException("session", token,
                "Session is full (max " + MAX_PARTICIPANTS + " participants).");
        }

        String displayName = resolveDisplayName(req.displayName(), user);
        ShareSessionParticipant participant = new ShareSessionParticipant(
            session.getId(), user.getId(), schedule.getId(), displayName);
        // saveAndFlush — the (sessionId,userId) PK acts as upsert via JPA merge
        participants.save(participant);

        return toResponse(session);
    }

    @Transactional
    public void leave(User user, String token) {
        ShareSession session = sessions.findByToken(token)
            .orElseThrow(() -> new ResourceNotFoundException("ShareSession", token));
        participants.findBySessionIdOrderByJoinedAtAsc(session.getId()).stream()
            .filter(p -> p.getUserId().equals(user.getId()))
            .findFirst()
            .ifPresent(participants::delete);
    }

    @Transactional
    public void delete(User user, String token) {
        ShareSession session = sessions.findByToken(token)
            // Returning 404 for non-creators is intentional: we don't want to
            // leak whether a token exists to anyone other than the creator.
            .filter(s -> s.getCreatorUserId().equals(user.getId()))
            .orElseThrow(() -> new ResourceNotFoundException("ShareSession", token));
        sessions.delete(session);
    }

    private ShareSessionResponse toResponse(ShareSession session) {
        List<ShareSessionParticipant> rows = participants.findBySessionIdOrderByJoinedAtAsc(session.getId());

        // Bulk-fetch all referenced saved_schedules to avoid N+1.
        List<UUID> scheduleIds = rows.stream()
            .map(ShareSessionParticipant::getSavedScheduleId)
            .filter(java.util.Objects::nonNull)
            .toList();
        Map<UUID, SavedSchedule> scheduleById = new HashMap<>();
        if (!scheduleIds.isEmpty()) {
            savedSchedules.findAllById(scheduleIds)
                .forEach(s -> scheduleById.put(s.getId(), s));
        }

        String creatorDisplayName = rows.stream()
            .filter(p -> p.getUserId().equals(session.getCreatorUserId()))
            .map(ShareSessionParticipant::getDisplayName)
            .findFirst()
            .orElse(null);

        List<ParticipantResponse> ps = rows.stream()
            .map(p -> {
                SavedSchedule s = p.getSavedScheduleId() != null ? scheduleById.get(p.getSavedScheduleId()) : null;
                return new ParticipantResponse(
                    p.getUserId(),
                    p.getDisplayName(),
                    p.getUserId().equals(session.getCreatorUserId()),
                    s != null ? s.getCareerId() : null,
                    s != null ? s.getPlan() : null,
                    s != null ? s.getPayload() : null,
                    p.getJoinedAt());
            })
            .toList();

        return new ShareSessionResponse(
            session.getId(),
            session.getToken(),
            session.getName(),
            creatorDisplayName,
            session.getExpiresAt(),
            session.getCreatedAt(),
            ps);
    }

    private String generateUniqueToken() {
        for (int i = 0; i < TOKEN_RETRIES; i++) {
            byte[] buf = new byte[TOKEN_BYTES];
            RNG.nextBytes(buf);
            String token = Base64.getUrlEncoder().withoutPadding().encodeToString(buf);
            if (!sessions.existsByToken(token)) return token;
        }
        // 96 bits of entropy: hitting this would imply RNG failure.
        throw new IllegalStateException("Could not allocate a unique share token after retries");
    }

    private String resolveDisplayName(String requested, User user) {
        if (requested != null && !requested.isBlank()) return requested.trim();
        if (user.getName() != null && !user.getName().isBlank()) {
            // Prefer first token of the full name to keep the heatmap legend short.
            return user.getName().trim().split("\\s+")[0];
        }
        // Pre-username fallback: local part of the email.
        String email = user.getEmail();
        int at = email.indexOf('@');
        return at > 0 ? email.substring(0, at) : email;
    }

}
