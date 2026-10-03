package org.ceitba.api.web.drive.dto;

import java.util.List;

public record SubjectFilesResponse(String subjectId, String subjectName, List<FileGroupResponse> groups) {}
