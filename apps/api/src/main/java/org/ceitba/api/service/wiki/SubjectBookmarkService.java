package org.ceitba.api.service.wiki;

import org.ceitba.api.domain.Subject;
import org.ceitba.api.domain.kb.KbPageStatus;
import org.ceitba.api.domain.wiki.SubjectBookmark;
import org.ceitba.api.repository.SubjectRepository;
import org.ceitba.api.repository.drive.DriveFileRepository;
import org.ceitba.api.repository.kb.KbPageRepository;
import org.ceitba.api.repository.wiki.SubjectBookmarkRepository;
import org.ceitba.api.web.wiki.dto.BookmarkStateResponse;
import org.ceitba.api.web.wiki.dto.PinnedSubjectResponse;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

// Subject bookmarks, also the "pinned subjects" of /apuntes (max
// MAX_PER_USER per user).
@Service
public class SubjectBookmarkService {

    public static final int MAX_PER_USER = 30;

    private final SubjectBookmarkRepository repo;
    private final SubjectRepository subjects;
    private final DriveFileRepository files;
    private final KbPageRepository kbPages;

    public SubjectBookmarkService(SubjectBookmarkRepository repo, SubjectRepository subjects,
                                  DriveFileRepository files, KbPageRepository kbPages) {
        this.repo = repo;
        this.subjects = subjects;
        this.files = files;
        this.kbPages = kbPages;
    }

    // The user's pinned subjects, most recently pinned first.
    @Transactional(readOnly = true)
    public List<PinnedSubjectResponse> pinned(UUID userId) {
        var pins = repo.findByUserIdOrderByUpdatedAtDescSubjectIdAsc(userId);
        if (pins.isEmpty()) return List.of();
        var ids = pins.stream().map(SubjectBookmark::getSubjectId).toList();
        Map<String, String> names = new HashMap<>();
        for (Subject s : subjects.findAllById(ids)) names.put(s.getId(), s.getName());
        Map<String, Long> counts = new HashMap<>();
        for (Object[] r : files.publishedSubjectsIn(ids)) counts.put((String) r[0], ((Number) r[1]).longValue());
        Set<String> withWiki = new HashSet<>(kbPages.findSubjectIdsWithPages(ids, List.of(KbPageStatus.PUBLISHED)));
        return pins.stream()
            .map(p -> new PinnedSubjectResponse(p.getSubjectId(), names.get(p.getSubjectId()),
                counts.getOrDefault(p.getSubjectId(), 0L), withWiki.contains(p.getSubjectId()), p.getUpdatedAt()))
            .toList();
    }

    @Transactional(readOnly = true)
    public BookmarkStateResponse getState(String subjectId, UUID userId) {
        long count = repo.countBySubjectId(subjectId);
        boolean bookmarked = userId != null && repo.existsBySubjectIdAndUserId(subjectId, userId);
        return new BookmarkStateResponse(count, bookmarked);
    }

    @Transactional
    public BookmarkStateResponse upsert(String subjectId, UUID userId) {
        if (!repo.existsBySubjectIdAndUserId(subjectId, userId)) {
            if (repo.countByUserId(userId) >= MAX_PER_USER) throw new BookmarkLimitException(MAX_PER_USER);
            repo.save(new SubjectBookmark(subjectId, userId));
        }
        return getState(subjectId, userId);
    }

    @Transactional
    public void remove(String subjectId, UUID userId) {
        if (repo.existsBySubjectIdAndUserId(subjectId, userId)) {
            repo.deleteBySubjectIdAndUserId(subjectId, userId);
        }
    }
}
