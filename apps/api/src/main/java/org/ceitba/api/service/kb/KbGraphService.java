package org.ceitba.api.service.kb;

import org.ceitba.api.domain.kb.KbPageStatus;
import org.ceitba.api.repository.SubjectRepository;
import org.ceitba.api.repository.kb.KbLinkRepository;
import org.ceitba.api.repository.kb.KbPageRepository;
import org.ceitba.api.web.kb.dto.KbGlobalGraphResponse;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

// The global wiki graph for the /apuntes home (GET /v1/wiki/kb/graph): all
// PUBLISHED pages and their resolved links. Identical for every caller, so
// the full graph is cached in memory and rebuilt lazily after invalidate(),
// which imports, hide/restore, report hiding and takedowns call (now and
// again after their transaction commits). A `subjects` filter is applied to
// the cached graph: the pages of those subjects plus the pages linked from
// or to them.
@Service
public class KbGraphService {

    private final KbPageRepository pages;
    private final KbLinkRepository links;
    private final SubjectRepository subjects;
    private volatile KbGlobalGraphResponse cached;

    public KbGraphService(KbPageRepository pages, KbLinkRepository links, SubjectRepository subjects) {
        this.pages = pages;
        this.links = links;
        this.subjects = subjects;
    }

    public void invalidate() {
        cached = null;
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    cached = null;
                }
            });
        }
    }

    @Transactional(readOnly = true)
    public KbGlobalGraphResponse graph(Collection<String> subjectFilter) {
        var full = cached;
        if (full == null) {
            full = build();
            cached = full;
        }
        if (subjectFilter == null || subjectFilter.isEmpty()) return full;
        return filter(full, new HashSet<>(subjectFilter));
    }

    private KbGlobalGraphResponse build() {
        var published = pages.findByStatus(KbPageStatus.PUBLISHED).stream().sorted(KbViews.ORDER).toList();
        Map<UUID, KbGlobalGraphResponse.Node> nodes = new java.util.LinkedHashMap<>();
        Map<String, Long> counts = new HashMap<>();
        for (var p : published) {
            nodes.put(p.getId(), new KbGlobalGraphResponse.Node(p.getId(), p.getSubjectId(), p.getSlug(), p.getTitle(),
                p.getType().wire()));
            counts.merge(p.getSubjectId(), 1L, Long::sum);
        }
        var edges = new LinkedHashSet<KbGlobalGraphResponse.Edge>();
        for (var l : links.findByToPageIdIsNotNull()) {
            var from = nodes.get(l.getFromPageId());
            var to = nodes.get(l.getToPageId());
            if (from == null || to == null || from.id().equals(to.id())) continue;
            edges.add(new KbGlobalGraphResponse.Edge(from.id(), to.id(), !from.subjectId().equals(to.subjectId())));
        }
        Map<String, String> names = new HashMap<>();
        subjects.findAllById(counts.keySet()).forEach(s -> names.put(s.getId(), s.getName()));
        var subjectDtos = counts.entrySet().stream()
            .map(e -> new KbGlobalGraphResponse.Subject(e.getKey(), names.get(e.getKey()), e.getValue()))
            .sorted(Comparator.comparing(KbGlobalGraphResponse.Subject::subjectId))
            .toList();
        return new KbGlobalGraphResponse(subjectDtos, List.copyOf(nodes.values()), List.copyOf(edges));
    }

    static KbGlobalGraphResponse filter(KbGlobalGraphResponse full, Set<String> wanted) {
        Set<UUID> core = new HashSet<>();
        Map<UUID, KbGlobalGraphResponse.Node> byId = new HashMap<>();
        for (var n : full.nodes()) {
            byId.put(n.id(), n);
            if (wanted.contains(n.subjectId())) core.add(n.id());
        }
        Set<UUID> keep = new HashSet<>(core);
        var edges = full.edges().stream()
            .filter(e -> core.contains(e.from()) || core.contains(e.to()))
            .toList();
        edges.forEach(e -> { keep.add(e.from()); keep.add(e.to()); });
        var nodes = full.nodes().stream().filter(n -> keep.contains(n.id())).toList();
        var subjectIds = new HashSet<String>();
        nodes.forEach(n -> subjectIds.add(n.subjectId()));
        var subjects = full.subjects().stream().filter(s -> subjectIds.contains(s.subjectId())).toList();
        return new KbGlobalGraphResponse(subjects, nodes, edges);
    }
}
