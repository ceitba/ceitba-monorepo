package org.ceitba.api.service.kb;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

// The checks of a parsed page that need the database (docs/SUBJECT-WIKI.md):
//   - every [[file:…]] citation is in `sources`;
//   - every source is a PUBLISHED Drive file whose effective subject is the
//     page's subject;
//   - no 40-word run is copied from a source's extracted text.
public final class KbValidator {

    private KbValidator() {}

    // What the validator needs to know about a cited Drive file. key: its
    // content fingerprint (shingle cache key; defaults to the file id).
    public record SourceInfo(UUID id, boolean published, String effectiveSubjectId, String text, String key) {
        public SourceInfo(UUID id, boolean published, String effectiveSubjectId, String text) {
            this(id, published, effectiveSubjectId, text, "file:" + id);
        }
    }

    public static List<String> validate(KbPageParser.Draft draft, Map<UUID, SourceInfo> sources) {
        return validate(draft, sources, new java.util.HashMap<>());
    }

    // shingles: per-call cache of each source's copy-detector shingles (by
    // SourceInfo.key), shared by every page of one import.
    public static List<String> validate(KbPageParser.Draft draft, Map<UUID, SourceInfo> sources,
                                        Map<String, java.util.Set<Long>> shingles) {
        var errors = new ArrayList<String>();
        for (var c : draft.links().citations()) {
            if (c.id() != null && !draft.sources().contains(c.id())) {
                errors.add("cites file " + c.id() + " which is not in sources");
            }
        }
        var texts = new ArrayList<java.util.Set<Long>>();
        for (var id : draft.sources()) {
            var info = sources.get(id);
            if (info == null) {
                errors.add("source " + id + " does not exist");
            } else if (!info.published()) {
                errors.add("source " + id + " is not a published file");
            } else if (!draft.subject().equals(info.effectiveSubjectId())) {
                errors.add("source " + id + " is not a file of subject " + draft.subject());
            } else {
                texts.add(shingles.computeIfAbsent(info.key(), k -> KbCopyDetector.shinglesOf(info.text())));
            }
        }
        var copied = KbCopyDetector.findCopyIn(draft.body(), texts);
        if (copied != null) {
            errors.add("copies " + KbCopyDetector.WINDOW + "+ consecutive words from a source: \""
                + abbreviate(copied) + "\"");
        }
        return errors;
    }

    private static String abbreviate(String s) {
        return s.length() <= 120 ? s : s.substring(0, 117) + "...";
    }
}
