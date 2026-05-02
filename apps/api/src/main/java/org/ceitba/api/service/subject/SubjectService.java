package org.ceitba.api.service.subject;

import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.repository.SubjectRepository;
import org.ceitba.api.web.subject.dto.SubjectResponse;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SubjectService {

    private final SubjectRepository subjectRepository;

    public SubjectService(SubjectRepository subjectRepository) {
        this.subjectRepository = subjectRepository;
    }

    @Transactional(readOnly = true)
    public SubjectResponse getSubjectById(String id) {
        var subject = subjectRepository.findById(id)
            .orElseThrow(() -> new ResourceNotFoundException("Subject", id));
        return new SubjectResponse(subject.getId(), subject.getName(), subject.getCredits());
    }
}
