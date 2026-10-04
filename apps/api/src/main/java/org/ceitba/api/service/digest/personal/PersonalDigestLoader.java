package org.ceitba.api.service.digest.personal;

import org.ceitba.api.config.ClockConfig;
import org.ceitba.api.config.DigestPersonalProperties;
import org.ceitba.api.domain.Commission;
import org.ceitba.api.domain.SavedSchedule;
import org.ceitba.api.domain.Subject;
import org.ceitba.api.domain.User;
import org.ceitba.api.domain.correction.ScheduleCorrection;
import org.ceitba.api.domain.correction.ScheduleCorrectionStatus;
import org.ceitba.api.domain.correction.ScheduleCorrectionVote;
import org.ceitba.api.domain.kb.KbPageType;
import org.ceitba.api.repository.CommissionRepository;
import org.ceitba.api.repository.SavedScheduleRepository;
import org.ceitba.api.repository.SubjectRepository;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.repository.correction.ScheduleCorrectionRepository;
import org.ceitba.api.repository.correction.ScheduleCorrectionVoteRepository;
import org.ceitba.api.repository.kb.KbPageRepository;
import org.ceitba.api.service.capability.Capability;
import org.ceitba.api.service.capability.CapabilityService;
import org.ceitba.api.service.correction.CorrectionSlots;
import org.ceitba.api.service.digest.DigestWeek;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

// Loads "Tu cuatrimestre" for a batch of readers in a fixed number of
// queries (about ten), whatever the batch size: users, primary schedules,
// "is a term running", the commissions of every scheduled subject, subject
// names, wiki capability + page heads, open corrections and the readers'
// votes on them.
@Service
public class PersonalDigestLoader {

    private final UserRepository users;
    private final SavedScheduleRepository schedules;
    private final CommissionRepository commissions;
    private final SubjectRepository subjects;
    private final KbPageRepository kbPages;
    private final ScheduleCorrectionRepository corrections;
    private final ScheduleCorrectionVoteRepository votes;
    private final CapabilityService capabilities;
    private final DigestPersonalProperties props;
    private final Clock clock;

    public PersonalDigestLoader(UserRepository users, SavedScheduleRepository schedules,
                                CommissionRepository commissions, SubjectRepository subjects,
                                KbPageRepository kbPages, ScheduleCorrectionRepository corrections,
                                ScheduleCorrectionVoteRepository votes, CapabilityService capabilities,
                                DigestPersonalProperties props, Clock clock) {
        this.users = users;
        this.schedules = schedules;
        this.commissions = commissions;
        this.subjects = subjects;
        this.kbPages = kbPages;
        this.corrections = corrections;
        this.votes = votes;
        this.capabilities = capabilities;
        this.props = props;
        this.clock = clock;
    }

    // Readers with nothing to show are left out of the map.
    @Transactional(readOnly = true)
    public Map<UUID, PersonalDigest> load(Collection<UUID> readerIds, DigestWeek week) {
        Set<UUID> ids = readerIds.stream().filter(java.util.Objects::nonNull).collect(Collectors.toSet());
        if (ids.isEmpty()) return Map.of();
        LocalDate today = LocalDate.now(clock);
        // Between terms (no commission running or about to start) there is
        // nothing to show, not even the call to action.
        if (!commissions.existsRunningOrStartingBy(today, today.plusDays(DigestTerm.LOOKAHEAD_DAYS))) return Map.of();

        // Primary schedules -> picks.
        Map<UUID, SavedSchedule> primary = new HashMap<>();
        for (var s : schedules.findByUserIdInAndPrimaryTrue(ids)) primary.put(s.getUserId(), s);
        Map<UUID, List<DigestTerm.Pick>> picks = new HashMap<>();
        Set<String> codes = new LinkedHashSet<>();
        primary.forEach((userId, s) -> {
            var p = DigestTerm.parsePayload(s.getPayload());
            picks.put(userId, p);
            p.forEach(x -> codes.add(x.subjectCode()));
        });

        // Current term of every scheduled subject (one query, times hydrated).
        Map<String, List<Commission>> currentBySubject = codes.isEmpty() ? Map.of()
            : DigestTerm.currentTermBySubject(commissions.findBySubjectCodeInWithTimes(codes), today);

        Map<UUID, DigestTerm.Resolution> resolved = new HashMap<>();
        Set<String> currentCodes = new LinkedHashSet<>();
        Set<String> ownCommissionIds = new HashSet<>();
        picks.forEach((userId, p) -> {
            var saved = primary.get(userId).getUpdatedAt();
            LocalDate savedOn = saved == null ? null : saved.atZoneSameInstant(ClockConfig.ZONE).toLocalDate();
            var r = DigestTerm.resolve(p, savedOn, currentBySubject);
            if (!r.current()) return;
            resolved.put(userId, r);
            for (var s : r.subjects()) {
                currentCodes.add(s.subjectCode());
                if (s.commissionName() != null) s.commissions().forEach(c -> ownCommissionIds.add(c.getId()));
            }
        });

        Map<String, String> names = currentCodes.isEmpty() ? Map.of()
            : subjects.findAllById(currentCodes).stream().collect(Collectors.toMap(Subject::getId, Subject::getName));

        // Wiki links only for readers who can open them (`apuntes` capability).
        Set<UUID> wikiReaders = Set.of();
        Map<String, WikiHead> wiki = Map.of();
        if (!resolved.isEmpty() && props.maxWikiLinks() > 0) {
            List<User> withSchedule = users.findAllById(resolved.keySet());
            wikiReaders = capabilities.holders(Capability.APUNTES, withSchedule);
            if (!wikiReaders.isEmpty()) wiki = wikiHeads(currentCodes, week);
        }

        // Open corrections on the readers' own commissions + their votes.
        Map<String, List<ScheduleCorrection>> pendingByCommission = new HashMap<>();
        Map<UUID, Set<UUID>> votedBy = new HashMap<>();
        if (!ownCommissionIds.isEmpty() && props.maxCorrections() > 0) {
            var pending = corrections.findByCommissionIdInAndStatusIn(ownCommissionIds,
                EnumSet.of(ScheduleCorrectionStatus.PENDING));
            for (var c : pending) pendingByCommission.computeIfAbsent(c.getCommissionId(), k -> new ArrayList<>()).add(c);
            if (!pending.isEmpty()) {
                var pendingIds = pending.stream().map(ScheduleCorrection::getId).toList();
                for (ScheduleCorrectionVote v : votes.findByUserIdInAndCorrectionIdIn(resolved.keySet(), pendingIds)) {
                    votedBy.computeIfAbsent(v.getUserId(), k -> new HashSet<>()).add(v.getCorrectionId());
                }
            }
        }
        Map<String, Commission> commissionById = currentBySubject.values().stream()
            .flatMap(List::stream)
            .collect(Collectors.toMap(Commission::getId, Function.identity(), (a, b) -> a));

        var out = new LinkedHashMap<UUID, PersonalDigest>();
        for (UUID userId : ids) {
            var r = resolved.get(userId);
            if (r == null) {
                out.put(userId, PersonalDigest.needsSchedule());
                continue;
            }
            var lines = new ArrayList<PersonalDigest.SubjectLine>();
            var links = new ArrayList<PersonalDigest.WikiLink>();
            Set<String> mine = new HashSet<>();
            boolean wikiReader = wikiReaders.contains(userId);
            for (var s : r.subjects()) {
                String name = names.getOrDefault(s.subjectCode(), s.subjectCode());
                lines.add(new PersonalDigest.SubjectLine(s.subjectCode(), name, s.commissionName()));
                if (s.commissionName() != null) s.commissions().forEach(c -> mine.add(c.getId()));
                var head = wiki.get(s.subjectCode());
                if (wikiReader && head != null && links.size() < props.maxWikiLinks()) {
                    links.add(new PersonalDigest.WikiLink(s.subjectCode(), name, head.url(), head.updatedThisWeek()));
                }
            }
            var candidates = mine.stream()
                .flatMap(id -> pendingByCommission.getOrDefault(id, List.of()).stream())
                .toList();
            var prompts = CorrectionPrompts.select(userId, mine, candidates,
                    votedBy.getOrDefault(userId, Set.of()), props.maxCorrections()).stream()
                .map(c -> {
                    var commission = commissionById.get(c.getCommissionId());
                    return new PersonalDigest.CorrectionPrompt(c.getId(),
                        names.getOrDefault(commission.getSubjectCode(), commission.getSubjectCode()),
                        commission.getCommissionName(), c.getProposedSlots(),
                        CorrectionSlots.fromTimes(commission.getTimes()));
                })
                .toList();
            out.put(userId, new PersonalDigest(PersonalDigest.State.CURRENT, lines, links, prompts));
        }
        return out;
    }

    private record WikiHead(String url, boolean updatedThisWeek) {}

    // Per subject with a PUBLISHED page: the link (its wiki tab, which shows
    // the index page; without an index, the most recently generated page) and
    // whether any page was (re)generated during the covered week (ART).
    private Map<String, WikiHead> wikiHeads(Collection<String> codes, DigestWeek week) {
        Map<String, List<Object[]>> bySubject = new HashMap<>();
        for (Object[] row : kbPages.findPublishedHeads(codes)) {
            bySubject.computeIfAbsent((String) row[0], k -> new ArrayList<>()).add(row);
        }
        var out = new HashMap<String, WikiHead>();
        bySubject.forEach((code, rows) -> {
            boolean hasIndex = rows.stream().anyMatch(r -> r[2] == KbPageType.INDEX);
            Object[] latest = rows.stream()
                .max(java.util.Comparator.comparing((Object[] r) -> (OffsetDateTime) r[3]))
                .orElseThrow();
            String base = props.wikiBaseUrl() + "/" + enc(code);
            String url = hasIndex ? base + "?vista=wiki" : base + "/wiki/" + enc((String) latest[1]);
            boolean updated = rows.stream().anyMatch(r -> {
                var day = ((OffsetDateTime) r[3]).atZoneSameInstant(ClockConfig.ZONE).toLocalDate();
                return !day.isBefore(week.weekStart()) && !day.isAfter(week.weekEnd());
            });
            out.put(code, new WikiHead(url, updated));
        });
        return out;
    }

    private static String enc(String s) {
        return URLEncoder.encode(s, StandardCharsets.UTF_8).replace("+", "%20");
    }
}
