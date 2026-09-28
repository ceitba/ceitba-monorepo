package org.ceitba.api.service.sync;

import org.ceitba.api.domain.ProposalStatus;
import org.ceitba.api.domain.User;
import org.ceitba.api.domain.proposal.ProposalLifecycle;
import org.ceitba.api.domain.proposal.ProposalTopic;
import org.ceitba.api.domain.proposal.ProposalVoteValue;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.repository.proposal.ProposalImportRepository;
import org.ceitba.api.service.crypto.ContentHmac;
import org.ceitba.api.service.proposal.ProposalAliasGenerator;
import org.ceitba.api.service.sync.FirestoreImportReport.Outcome;
import org.springframework.stereotype.Component;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

// Maps one legacy Firestore 'Propuestas' document onto the B5 proposal tables.
//
//   id              -> proposal.id = name-based UUID of the document id, so a
//                      re-run finds the same row (idempotent, no extra column)
//   title           -> title (required; > 100 chars truncated, warned)
//   description     -> description (missing = ""; > 5000 truncated, warned)
//   topic           -> VIDA_UNIVERSITARIA | CEITBA | EVENTOS | CURSOS | OTROS,
//                      matched ignoring case, accents and spaces ("Vida
//                      universitaria"); unknown or missing -> OTROS, warned
//   authorized      -> status: 0 PENDING, 1 APPROVED, 2 REJECTED (anything
//                      else is an error: the document is not imported)
//   status          -> lifecycle ABIERTO | ACEPTADO | CERRADO, any case;
//                      missing -> ABIERTO, unknown -> ABIERTO, warned
//   rejectionReason -> rejection_reason, REJECTED only ("" = none)
//   mod             -> moderated_by (Firebase uid -> user); moderated_at stays
//                      NULL: the legacy data never recorded when
//   dateTime        -> created_at (missing/invalid -> import time, warned)
//   author          -> author_id (Firebase uid -> user.firebase_uid). An
//                      author who was not imported leaves author_id NULL, the
//                      state of a proposal whose author deleted their account.
//                      A proposal not in the DB whose author deleted their
//                      account (deleted_firebase_accounts) is SKIPPED: account
//                      deletion removed it, and a re-run must not bring it back
//   votes           -> proposal_vote: {uid: {like: true|false, timestamp}},
//                      like true = UP, false = DOWN; unknown voters dropped
//   comments        -> proposal_comment: [{author, comment, dateTime,
//                      replies: [...]}]; replies (at any depth) hang from
//                      their top-level comment, the one level B5 supports.
//                      Blank comments are dropped, > 1000 chars truncated.
//                      Unknown commenters keep the comment with no author
//                      (shown without alias). Ids are derived from the
//                      document id + author + dateTime so re-runs match, but
//                      through HMAC-SHA256 under a ContentHmac-derived key
//                      (see commentId): the API returns comment ids, and a plain
//                      name-based UUID of those inputs would let anyone with
//                      the legacy uid list test who wrote a comment.
//   userNames       -> proposal_alias {uid: alias} (> 40 chars, blank or
//                      already taken on the proposal -> a fresh alias).
//                      The author and every commenter without one gets a
//                      generated alias, as B5 does on first write.
//   filesURL        -> proposal_attachment in order (position 0 = cover).
//                      Entries must be R2 keys proposals/legacy/{uuid}.{ext},
//                      which scripts/firestore-export writes after copying
//                      each Firebase Storage file to R2 (--copy-attachments).
//                      Anything else, including a raw Firebase download URL
//                      (the export was run without the copy step), is
//                      dropped and warned: legacy URLs stop working once the
//                      old Firebase project is retired, and a dropped
//                      attachment is added by a later re-run with copied
//                      keys, whereas a stored URL would hold its position.
//                      Content type comes from the key's extension.
//   favourites      -> not imported (the new board has no favourites)
//
// Re-runs are additive: a proposal that already exists keeps its fields and
// only gains votes, comments, aliases and attachments it is missing; the
// counters are then recomputed from the rows. Re-runs must use the same
// ContentHmac root secret (CONTENT_HMAC_SECRET, else AUTH_JWT_SECRET):
// comment ids are keyed on it, so a rotated secret would import every
// legacy comment again. Outcome: CREATED for a new
// proposal, UPDATED when a re-run added rows, SKIPPED otherwise.
// Warnings never name users (ids, emails or aliases), only counts.
@Component
public class ProposalFirestoreImporter implements FirestoreProposalImporter {

    static final int MAX_TITLE = 100;
    static final int MAX_DESCRIPTION = 5000;
    static final int MAX_REASON = 1024;
    static final int MAX_COMMENT = 1000;
    static final int MAX_ALIAS = 40;

    private static final Pattern NON_WORD = Pattern.compile("[^A-Z0-9]+");
    private static final Pattern MARKS = Pattern.compile("\\p{M}+");
    private static final Map<String, String> CONTENT_TYPES = Map.of(
        "jpg", "image/jpeg", "jpeg", "image/jpeg", "png", "image/png", "webp", "image/webp",
        "gif", "image/gif", "heic", "image/heic", "pdf", "application/pdf");
    // Written by scripts/firestore-export --copy-attachments. The legacy/
    // prefix never matches a user-signed key (proposals/{uuid}-{tag}.{ext},
    // see MediaUploadService), so POST /v1/proposals cannot reference these.
    static final Pattern LEGACY_ATTACHMENT_KEY = Pattern.compile(
        "^proposals/legacy/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(jpg|jpeg|png|webp|gif|heic|pdf)$");

    private final ProposalImportRepository rows;
    private final UserRepository users;
    private final ProposalAliasGenerator aliasGenerator;
    private final Clock clock;
    private final ContentHmac hmac;

    public ProposalFirestoreImporter(ProposalImportRepository rows, UserRepository users,
                                     ProposalAliasGenerator aliasGenerator, Clock clock, ContentHmac hmac) {
        this.rows = rows;
        this.users = users;
        this.aliasGenerator = aliasGenerator;
        this.clock = clock;
        this.hmac = hmac;
    }

    @Override
    public boolean isAvailable() {
        return true;
    }

    public static UUID proposalId(String documentId) {
        return nameUuid("firestore:propuestas:" + documentId);
    }

    @Override
    public Outcome importProposal(String documentId, Map<String, Object> doc, List<String> warnings) {
        UUID id = proposalId(documentId);
        String title = str(doc.get("title"));
        if (title == null) throw new FirestoreImportException("missing title");
        title = truncate(title, MAX_TITLE, "title", warnings);
        String description = str(doc.get("description"));
        description = description == null ? "" : truncate(description, MAX_DESCRIPTION, "description", warnings);
        ProposalTopic topic = topic(doc.get("topic"), warnings);
        ProposalStatus status = moderation(doc.get("authorized"));
        ProposalLifecycle lifecycle = lifecycle(doc.get("status"), warnings);
        String reason = status == ProposalStatus.REJECTED
            ? truncateOrNull(str(doc.get("rejectionReason")), MAX_REASON, "rejectionReason", warnings)
            : null;
        OffsetDateTime now = OffsetDateTime.now(clock);
        OffsetDateTime createdAt = time(doc.get("dateTime"));
        if (createdAt == null) {
            warnings.add("missing or invalid dateTime; import time used");
            createdAt = now;
        }

        List<LegacyComment> comments = flattenComments(doc.get("comments"), createdAt);
        Map<String, UUID> byUid = resolveUsers(doc, comments);

        UUID authorId = lookup(byUid, doc.get("author"));
        String authorUid = str(doc.get("author"));
        if (authorId == null && authorUid != null && users.isDeletedFirebaseAccount(authorUid)
            && !rows.proposalExists(id)) {
            warnings.add("author deleted their account; proposal not re-imported");
            return Outcome.SKIPPED;
        }
        if (authorId == null) warnings.add("author not imported; proposal kept without author");
        UUID moderatedBy = status == ProposalStatus.PENDING ? null : lookup(byUid, doc.get("mod"));

        boolean created = rows.insertProposal(id, authorId, title, description, topic.name(), status.name(),
            lifecycle.name(), reason, moderatedBy, createdAt);
        if (!created) rows.lockProposal(id);
        boolean changed = false;

        var aliases = new Aliases(id, rows.aliases(id));
        changed |= importUserNames(doc.get("userNames"), byUid, aliases);
        if (authorId != null) changed |= aliases.ensure(authorId, null);
        changed |= importVotes(doc.get("votes"), byUid, id, createdAt, warnings);
        changed |= importComments(documentId, id, comments, byUid, aliases, warnings);
        changed |= importAttachments(doc.get("filesURL"), id, warnings);

        rows.recomputeCounters(id);
        if (created) return Outcome.CREATED;
        return changed ? Outcome.UPDATED : Outcome.SKIPPED;
    }

    // ---------------------------------------------------------------- users

    private Map<String, UUID> resolveUsers(Map<String, Object> doc, List<LegacyComment> comments) {
        Set<String> uids = new HashSet<>();
        addIfPresent(uids, str(doc.get("author")));
        addIfPresent(uids, str(doc.get("mod")));
        if (doc.get("votes") instanceof Map<?, ?> votes) votes.keySet().forEach(k -> addIfPresent(uids, str(k)));
        if (doc.get("userNames") instanceof Map<?, ?> names) names.keySet().forEach(k -> addIfPresent(uids, str(k)));
        comments.forEach(c -> addIfPresent(uids, c.authorUid()));
        if (uids.isEmpty()) return Map.of();
        return users.findByFirebaseUidIn(uids).stream()
            .collect(Collectors.toMap(User::getFirebaseUid, User::getId));
    }

    private static UUID lookup(Map<String, UUID> byUid, Object uid) {
        String key = str(uid);
        return key == null ? null : byUid.get(key);
    }

    private static void addIfPresent(Collection<String> into, String value) {
        if (value != null) into.add(value);
    }

    // -------------------------------------------------------------- aliases

    // The proposal's aliases, kept unique while the import adds to them.
    private final class Aliases {
        private final UUID proposalId;
        private final Map<UUID, String> byUser;
        private final Set<String> taken;

        Aliases(UUID proposalId, Map<UUID, String> existing) {
            this.proposalId = proposalId;
            this.byUser = new HashMap<>(existing);
            this.taken = new HashSet<>(existing.values());
        }

        // Gives `userId` an alias unless it has one: `preferred` when it is
        // usable and free, a generated one otherwise. True when inserted.
        boolean ensure(UUID userId, String preferred) {
            if (byUser.containsKey(userId)) return false;
            String alias = preferred;
            if (alias == null || alias.length() > MAX_ALIAS || taken.contains(alias)) {
                alias = aliasGenerator.next(Set.copyOf(taken));
            }
            byUser.put(userId, alias);
            taken.add(alias);
            return rows.insertAlias(proposalId, userId, alias);
        }
    }

    private static boolean importUserNames(Object raw, Map<String, UUID> byUid, Aliases aliases) {
        if (!(raw instanceof Map<?, ?> names)) return false;
        boolean changed = false;
        // Sorted by uid so a re-run makes the same choices.
        for (var e : new TreeMap<>(stringMap(names)).entrySet()) {
            UUID userId = byUid.get(e.getKey());
            if (userId != null) changed |= aliases.ensure(userId, str(e.getValue()));
        }
        return changed;
    }

    // ---------------------------------------------------------------- votes

    private boolean importVotes(Object raw, Map<String, UUID> byUid, UUID proposalId,
                                OffsetDateTime fallback, List<String> warnings) {
        if (raw == null) return false;
        if (!(raw instanceof Map<?, ?> votes)) {
            warnings.add("votes is not a map; ignored");
            return false;
        }
        boolean changed = false;
        int unknownVoters = 0;
        int invalid = 0;
        for (var e : stringMap(votes).entrySet()) {
            UUID userId = byUid.get(e.getKey());
            if (userId == null) {
                unknownVoters++;
                continue;
            }
            Object like = e.getValue() instanceof Map<?, ?> v ? v.get("like") : null;
            if (!(like instanceof Boolean up)) {
                invalid++;
                continue;
            }
            OffsetDateTime at = time(((Map<?, ?>) e.getValue()).get("timestamp"));
            changed |= rows.insertVote(proposalId, userId,
                (up ? ProposalVoteValue.UP : ProposalVoteValue.DOWN).name(), at != null ? at : fallback);
        }
        if (unknownVoters > 0) warnings.add(unknownVoters + " votes by users not imported dropped");
        if (invalid > 0) warnings.add(invalid + " malformed votes dropped");
        return changed;
    }

    // ------------------------------------------------------------- comments

    // A legacy comment or reply, flattened. parentIndex is the index of its
    // top-level comment in the flattened list (null for top-level ones);
    // key identifies it stably within the document.
    record LegacyComment(Integer parentIndex, String authorUid, String body, OffsetDateTime at, String key) {}

    static List<LegacyComment> flattenComments(Object raw, OffsetDateTime fallback) {
        var out = new ArrayList<LegacyComment>();
        if (!(raw instanceof List<?> list)) return out;
        var seen = new HashMap<String, Integer>();
        for (Object top : list) {
            if (!(top instanceof Map<?, ?> m)) continue;
            int topIndex = out.size();
            String topKey = add(out, seen, null, "", m, fallback);
            addReplies(out, seen, topIndex, topKey, m.get("replies"), fallback);
        }
        return out;
    }

    private static void addReplies(List<LegacyComment> out, Map<String, Integer> seen, int topIndex,
                                   String topKey, Object raw, OffsetDateTime fallback) {
        if (!(raw instanceof List<?> replies)) return;
        for (Object r : replies) {
            if (!(r instanceof Map<?, ?> m)) continue;
            add(out, seen, topIndex, topKey, m, fallback);
            // Deeper replies (never produced by the old app) join the same thread.
            addReplies(out, seen, topIndex, topKey, m.get("replies"), fallback);
        }
    }

    private static String add(List<LegacyComment> out, Map<String, Integer> seen, Integer parentIndex,
                              String parentKey, Map<?, ?> m, OffsetDateTime fallback) {
        String author = str(m.get("author"));
        Object rawTime = m.get("dateTime");
        OffsetDateTime at = time(rawTime);
        String base = parentKey + "/" + author + "@" + (rawTime == null ? "" : rawTime.toString());
        int ordinal = seen.merge(base, 1, Integer::sum);
        String key = base + "#" + ordinal;
        out.add(new LegacyComment(parentIndex, author, str(m.get("comment")), at != null ? at : fallback, key));
        return key;
    }

    private boolean importComments(String documentId, UUID proposalId, List<LegacyComment> comments,
                                   Map<String, UUID> byUid, Aliases aliases, List<String> warnings) {
        boolean changed = false;
        int unknownAuthors = 0;
        int blank = 0;
        int truncated = 0;
        var ids = new UUID[comments.size()];
        for (int i = 0; i < comments.size(); i++) {
            LegacyComment c = comments.get(i);
            ids[i] = commentId(documentId, c.key());
            UUID parentId = c.parentIndex() == null ? null : ids[c.parentIndex()];
            if (c.body() == null) {
                // A blank top-level comment still anchors its replies, as a tombstone.
                blank++;
                if (c.parentIndex() != null || !hasReplies(comments, i)) continue;
            }
            UUID authorId = lookup(byUid, c.authorUid());
            if (authorId == null) unknownAuthors++;
            else changed |= aliases.ensure(authorId, null);
            String body = c.body();
            if (body != null && body.length() > MAX_COMMENT) {
                body = cut(body, MAX_COMMENT);
                truncated++;
            }
            if (body == null) {
                changed |= rows.insertDeletedComment(ids[i], proposalId, parentId, c.at());
            } else {
                changed |= rows.insertComment(ids[i], proposalId, authorId, parentId, body, c.at());
            }
        }
        if (unknownAuthors > 0) warnings.add(unknownAuthors + " comments by users not imported kept without author");
        if (blank > 0) warnings.add(blank + " blank comments dropped");
        if (truncated > 0) warnings.add(truncated + " comments longer than " + MAX_COMMENT + " characters truncated");
        return changed;
    }

    private static boolean hasReplies(List<LegacyComment> comments, int topIndex) {
        return comments.stream().anyMatch(c -> Integer.valueOf(topIndex).equals(c.parentIndex()) && c.body() != null);
    }

    // ---------------------------------------------------------- attachments

    private boolean importAttachments(Object raw, UUID proposalId, List<String> warnings) {
        if (!(raw instanceof List<?> keys)) return false;
        boolean changed = false;
        int position = 0;
        int notCopied = 0;
        int invalid = 0;
        for (Object k : keys) {
            String key = str(k);
            if (key == null) continue;
            var m = LEGACY_ATTACHMENT_KEY.matcher(key);
            if (!m.matches()) {
                if (key.startsWith("https://") || key.startsWith("http://")) notCopied++;
                else invalid++;
                continue;
            }
            changed |= rows.insertAttachment(proposalId, position++, key, CONTENT_TYPES.get(m.group(1)));
        }
        if (notCopied > 0) warnings.add(notCopied + " filesURL entries not copied to R2 dropped"
            + " (re-export with --copy-attachments)");
        if (invalid > 0) warnings.add(invalid + " malformed filesURL entries dropped");
        return changed;
    }

    // ------------------------------------------------------------- fields

    static ProposalTopic topic(Object raw, List<String> warnings) {
        String t = str(raw);
        if (t != null) {
            String normalized = NON_WORD.matcher(
                MARKS.matcher(Normalizer.normalize(t, Normalizer.Form.NFD)).replaceAll("").toUpperCase(Locale.ROOT)
            ).replaceAll("_");
            normalized = normalized.replaceAll("^_+|_+$", "");
            for (ProposalTopic candidate : ProposalTopic.values()) {
                if (candidate.name().equals(normalized)) return candidate;
            }
        }
        warnings.add((t == null ? "missing" : "unknown") + " topic; filed under " + ProposalTopic.OTROS);
        return ProposalTopic.OTROS;
    }

    static ProposalStatus moderation(Object raw) {
        Integer value = raw instanceof Number n && n.doubleValue() == n.intValue() ? n.intValue() : null;
        if (value == null && raw instanceof String s) {
            try {
                value = Integer.valueOf(s.trim());
            } catch (NumberFormatException ignored) {
                // falls through to the error below
            }
        }
        if (value == null) throw new FirestoreImportException("authorized must be 0, 1 or 2");
        return switch (value) {
            case 0 -> ProposalStatus.PENDING;
            case 1 -> ProposalStatus.APPROVED;
            case 2 -> ProposalStatus.REJECTED;
            default -> throw new FirestoreImportException("authorized must be 0, 1 or 2");
        };
    }

    static ProposalLifecycle lifecycle(Object raw, List<String> warnings) {
        String s = str(raw);
        if (s == null) return ProposalLifecycle.ABIERTO;
        try {
            return ProposalLifecycle.valueOf(s.toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            warnings.add("unknown status; imported as " + ProposalLifecycle.ABIERTO);
            return ProposalLifecycle.ABIERTO;
        }
    }

    // ISO-8601 (what scripts/firestore-export writes) or a raw Firestore
    // Timestamp map {_seconds|seconds, _nanoseconds|nanoseconds}.
    static OffsetDateTime time(Object raw) {
        if (raw instanceof String s && !s.isBlank()) {
            try {
                return OffsetDateTime.parse(s.trim());
            } catch (DateTimeParseException e) {
                return null;
            }
        }
        if (raw instanceof Map<?, ?> m) {
            Object sec = m.containsKey("_seconds") ? m.get("_seconds") : m.get("seconds");
            Object nanos = m.containsKey("_nanoseconds") ? m.get("_nanoseconds") : m.get("nanoseconds");
            if (sec instanceof Number n) {
                long ns = nanos instanceof Number x ? x.longValue() : 0L;
                return Instant.ofEpochSecond(n.longValue(), ns).atOffset(ZoneOffset.UTC);
            }
        }
        return null;
    }

    private static String truncate(String value, int max, String field, List<String> warnings) {
        if (value.length() <= max) return value;
        warnings.add(field + " longer than " + max + " characters truncated");
        return cut(value, max);
    }

    // Never splits a surrogate pair.
    static String cut(String value, int max) {
        if (value.length() <= max) return value;
        int end = Character.isHighSurrogate(value.charAt(max - 1)) ? max - 1 : max;
        return value.substring(0, end);
    }

    private static String truncateOrNull(String value, int max, String field, List<String> warnings) {
        return value == null ? null : truncate(value, max, field, warnings);
    }

    private static Map<String, Object> stringMap(Map<?, ?> raw) {
        var out = new HashMap<String, Object>();
        raw.forEach((k, v) -> {
            String key = str(k);
            if (key != null) out.put(key, v);
        });
        return out;
    }

    static String str(Object o) {
        if (!(o instanceof String s)) return null;
        String t = s.trim();
        return t.isEmpty() ? null : t;
    }

    private static UUID nameUuid(String name) {
        return UUID.nameUUIDFromBytes(name.getBytes(StandardCharsets.UTF_8));
    }

    // Stable for a given (document, comment key) under the same root secret,
    // and not computable without it. Formatted as a version-4-shaped UUID.
    UUID commentId(String documentId, String key) {
        byte[] digest = hmac.sign(ContentHmac.FIRESTORE_COMMENT_IDS, documentId + ":" + key);
        digest[6] = (byte) ((digest[6] & 0x0f) | 0x40);
        digest[8] = (byte) ((digest[8] & 0x3f) | 0x80);
        var bytes = ByteBuffer.wrap(digest, 0, 16);
        return new UUID(bytes.getLong(), bytes.getLong());
    }
}
