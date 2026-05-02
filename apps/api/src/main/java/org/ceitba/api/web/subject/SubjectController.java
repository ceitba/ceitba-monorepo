package org.ceitba.api.web.subject;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.ceitba.api.service.subject.SubjectService;
import org.ceitba.api.web.subject.dto.SubjectResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "Subjects")
@RestController
@RequestMapping("/v1/subjects")
public class SubjectController {

    private final SubjectService subjectService;

    public SubjectController(SubjectService subjectService) {
        this.subjectService = subjectService;
    }

    @GetMapping("/{id}")
    @Operation(summary = "Get a subject by ID")
    public SubjectResponse getSubjectById(@PathVariable String id) {
        return subjectService.getSubjectById(id);
    }
}
