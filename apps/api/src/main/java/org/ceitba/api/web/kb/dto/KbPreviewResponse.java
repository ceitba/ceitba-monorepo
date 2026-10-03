package org.ceitba.api.web.kb.dto;

import java.util.List;

// What the next run would do, computed without calling the LLM. Token
// numbers are rough input estimates (chars / 3.5).
public record KbPreviewResponse(
    List<Subject> dirty,
    int cleanSubjects,
    long estimatedTokens,
    long tokenBudget
) {
    public record File(String fileId, String name, Integer academicYear, int chars, boolean needsDigest) {}

    public record Subject(String subjectId, String subjectName, boolean hasState, List<File> added,
                          List<File> changed, List<String> removed, int digestsNeeded, long estimatedTokens) {}
}
