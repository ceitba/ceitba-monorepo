package org.ceitba.api.service.kb.pipeline;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import org.ceitba.api.domain.kb.KbPageStatus;
import org.ceitba.api.domain.kb.KbSubjectState;
import org.ceitba.api.repository.drive.DriveFileRepository;
import org.ceitba.api.repository.kb.KbPageRepository;
import org.ceitba.api.repository.kb.KbSubjectStateRepository;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.UUID;

// Change detection (docs/SUBJECT-WIKI-PIPELINE.md): a subject's inputs are
// its PUBLISHED (so not hidden, not removed) files with usable text, as
// sorted {fileId, fingerprint, academicYear}; it is dirty when files were
// added, changed (new fingerprint) or removed since kb_subject_state.
// Year-only changes do not make it dirty. Callers own the transaction.
@Component
public class KbInputs {

    // Below this much extracted text a file is an image/spreadsheet/etc.
    static final int MIN_TEXT_CHARS = 200;

    private final DriveFileRepository files;
    private final KbPageRepository pages;
    private final KbSubjectStateRepository states;
    private final ObjectMapper json;

    public KbInputs(DriveFileRepository files, KbPageRepository pages, KbSubjectStateRepository states,
                    ObjectMapper json) {
        this.files = files;
        this.pages = pages;
        this.states = states;
        this.json = json;
    }

    public record Input(UUID fileId, String fingerprint, Integer academicYear, String name, int chars) {}

    public record Diff(String subjectId, List<Input> current, List<Input> added, List<Input> changed,
                       List<UUID> removed, boolean hasState) {

        public boolean dirty() {
            return !added.isEmpty() || !changed.isEmpty() || !removed.isEmpty();
        }

        // Change size: added + changed chars, then removed count.
        public long priority() {
            long chars = 0;
            for (var i : added) chars += i.chars();
            for (var i : changed) chars += i.chars();
            return chars * 1000 + Math.min(removed.size(), 999);
        }
    }

    // Current inputs of every subject with published text.
    public Map<String, List<Input>> current() {
        Map<String, List<Input>> out = new TreeMap<>();
        for (Object[] r : files.pipelineInputs(MIN_TEXT_CHARS)) {
            var input = new Input((UUID) r[0], (String) r[2], r[3] == null ? null : ((Number) r[3]).intValue(),
                (String) r[4], ((Number) r[5]).intValue());
            out.computeIfAbsent((String) r[1], k -> new ArrayList<>()).add(input);
        }
        out.values().forEach(l -> l.sort(Comparator.comparing(i -> i.fileId().toString())));
        return out;
    }

    // Diffs of every subject (not paused) that has inputs, pages or a state.
    public List<Diff> diffs(java.util.function.Predicate<String> paused) {
        return diffs(paused, current());
    }

    // Same, from inputs already read with current().
    public List<Diff> diffs(java.util.function.Predicate<String> paused, Map<String, List<Input>> current) {
        Map<String, KbSubjectState> stateBySubject = new HashMap<>();
        states.findAll().forEach(s -> stateBySubject.put(s.getSubjectId(), s));
        Set<String> subjects = new TreeSet<>(current.keySet());
        subjects.addAll(stateBySubject.keySet());
        subjects.addAll(subjectsWithPages());
        var out = new ArrayList<Diff>();
        for (var subject : subjects) {
            if (paused.test(subject)) continue;
            out.add(diff(subject, current.getOrDefault(subject, List.of()), stateBySubject.get(subject)));
        }
        return out;
    }

    Diff diff(String subjectId, List<Input> current, KbSubjectState state) {
        Map<UUID, String> before = new HashMap<>();
        if (state != null) {
            for (var n : state.getInputs()) {
                before.put(UUID.fromString(n.path("fileId").asText()), n.path("fingerprint").asText(null));
            }
        }
        var added = new ArrayList<Input>();
        var changed = new ArrayList<Input>();
        var now = new java.util.HashSet<UUID>();
        for (var i : current) {
            now.add(i.fileId());
            if (!before.containsKey(i.fileId())) added.add(i);
            else if (!Objects.equals(before.get(i.fileId()), i.fingerprint())) changed.add(i);
        }
        var removed = new ArrayList<UUID>();
        for (var id : before.keySet()) if (!now.contains(id)) removed.add(id);
        removed.sort(Comparator.comparing(UUID::toString));
        return new Diff(subjectId, current, added, changed, removed, state != null);
    }

    public List<String> subjectsWithPages() {
        return pages.findSubjectIdsWithStatusNot(KbPageStatus.REMOVED).stream().sorted().toList();
    }

    public ArrayNode toJson(List<Input> inputs) {
        var arr = json.createArrayNode();
        for (var i : inputs) {
            var o = arr.addObject();
            o.put("fileId", i.fileId().toString());
            o.put("fingerprint", i.fingerprint());
            if (i.academicYear() == null) o.putNull("academicYear"); else o.put("academicYear", i.academicYear());
        }
        return arr;
    }

    public static String hash(JsonNode inputs) {
        try {
            var d = MessageDigest.getInstance("SHA-256").digest(inputs.toString().getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(d);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
