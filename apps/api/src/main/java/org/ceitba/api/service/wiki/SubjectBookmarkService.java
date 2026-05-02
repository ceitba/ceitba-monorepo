package org.ceitba.api.service.wiki;

import org.ceitba.api.domain.wiki.SubjectBookmark;
import org.ceitba.api.repository.wiki.SubjectBookmarkRepository;
import org.ceitba.api.web.wiki.dto.BookmarkStateResponse;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Service
public class SubjectBookmarkService {

    private final SubjectBookmarkRepository repo;

    public SubjectBookmarkService(SubjectBookmarkRepository repo) {
        this.repo = repo;
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
