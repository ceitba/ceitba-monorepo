package org.ceitba.api.service.sync;

import org.ceitba.api.domain.ProposalStatus;
import org.ceitba.api.domain.User;
import org.ceitba.api.domain.proposal.ProposalLifecycle;
import org.ceitba.api.domain.proposal.ProposalTopic;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.repository.proposal.ProposalImportRepository;
import org.ceitba.api.service.crypto.ContentHmac;
import org.ceitba.api.service.proposal.ProposalAliasGenerator;
import org.ceitba.api.service.sync.FirestoreImportReport.Outcome;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

// Field mapping and row decisions of ProposalFirestoreImporter against an
// in-memory recording repository (concrete classes are not mocked: inline
// mocking does not work on every JDK). FirestoreImportIT runs the same
// mapping against Postgres.
class ProposalFirestoreImporterTest {

    private static final Instant NOW = Instant.parse("2026-01-01T00:00:00Z");
    private static final OffsetDateTime CREATED = OffsetDateTime.parse("2024-05-01T12:00:00Z");
    private static final String SECRET = "dGVzdC1qd3Qtc2VjcmV0LWtleS0zMmJ5dGVzLWxvbmch";
    private static final String LEGACY_KEY = "proposals/legacy/0f8e2a4c-1b3d-4e5f-8a7b-9c0d1e2f3a4b.png";

    record ProposalRow(UUID id, UUID authorId, String title, String description, String topic, String status,
                       String lifecycle, String rejectionReason, UUID moderatedBy, OffsetDateTime createdAt) {}
    record AliasRow(UUID proposalId, UUID userId, String alias) {}
    record VoteRow(UUID proposalId, UUID userId, String value, OffsetDateTime at) {}
    record CommentRow(UUID id, UUID proposalId, UUID authorId, UUID parentId, String body, OffsetDateTime at) {}
    record AttachmentRow(UUID proposalId, int position, String key, String contentType) {}

    static final class RecordingRows extends ProposalImportRepository {
        boolean proposalIsNew = true;
        boolean voteIsNew = true;
        final Map<UUID, Map<UUID, String>> existingAliases = new HashMap<>();
        final List<ProposalRow> proposals = new ArrayList<>();
        final List<UUID> locked = new ArrayList<>();
        final List<AliasRow> aliases = new ArrayList<>();
        final List<VoteRow> votes = new ArrayList<>();
        final List<CommentRow> comments = new ArrayList<>();
        final List<CommentRow> tombstones = new ArrayList<>();
        final List<AttachmentRow> attachments = new ArrayList<>();
        final List<UUID> recomputed = new ArrayList<>();
        final Set<UUID> existing = new HashSet<>();

        RecordingRows() {
            super(null);
        }

        @Override
        public boolean insertProposal(UUID id, UUID authorId, String title, String description, String topic,
                                      String status, String lifecycle, String rejectionReason,
                                      UUID moderatedBy, OffsetDateTime createdAt) {
            proposals.add(new ProposalRow(id, authorId, title, description, topic, status, lifecycle,
                rejectionReason, moderatedBy, createdAt));
            return proposalIsNew;
        }

        @Override public boolean proposalExists(UUID id) { return existing.contains(id); }

        @Override public void lockProposal(UUID id) { locked.add(id); }

        @Override public Map<UUID, String> aliases(UUID proposalId) {
            return existingAliases.getOrDefault(proposalId, Map.of());
        }

        @Override public boolean insertAlias(UUID proposalId, UUID userId, String alias) {
            aliases.add(new AliasRow(proposalId, userId, alias));
            return true;
        }

        @Override public boolean insertVote(UUID proposalId, UUID userId, String value, OffsetDateTime at) {
            votes.add(new VoteRow(proposalId, userId, value, at));
            return voteIsNew;
        }

        @Override public boolean insertComment(UUID id, UUID proposalId, UUID authorId, UUID parentId,
                                               String body, OffsetDateTime at) {
            comments.add(new CommentRow(id, proposalId, authorId, parentId, body, at));
            return true;
        }

        @Override public boolean insertDeletedComment(UUID id, UUID proposalId, UUID parentId, OffsetDateTime at) {
            tombstones.add(new CommentRow(id, proposalId, null, parentId, null, at));
            return true;
        }

        @Override public boolean insertAttachment(UUID proposalId, int position, String key, String contentType) {
            attachments.add(new AttachmentRow(proposalId, position, key, contentType));
            return true;
        }

        @Override public void recomputeCounters(UUID proposalId) { recomputed.add(proposalId); }
    }

    // Hands out GeneradoUno, GeneradoDos, ... and records what was taken.
    static final class SequentialAliases extends ProposalAliasGenerator {
        final List<Set<String>> takenSeen = new ArrayList<>();
        private final String[] names = {"GeneradoUno", "GeneradoDos", "GeneradoTres", "GeneradoCuatro"};

        @Override
        public String next(Set<String> taken) {
            takenSeen.add(Set.copyOf(taken));
            return names[takenSeen.size() - 1];
        }
    }

    private RecordingRows rows;
    private SequentialAliases generator;
    private ProposalFirestoreImporter importer;
    private final List<String> warnings = new ArrayList<>();

    private final UUID author = UUID.randomUUID();
    private final UUID voter = UUID.randomUUID();
    private final Set<String> deletedUids = new HashSet<>();

    @BeforeEach
    void setUp() {
        rows = new RecordingRows();
        generator = new SequentialAliases();
        importer = importer(SECRET);
    }

    private ProposalFirestoreImporter importer(String secret) {
        UserRepository users = mock(UserRepository.class);
        when(users.findByFirebaseUidIn(any())).thenReturn(List.of(user("uid-author", author), user("uid-voter", voter)));
        when(users.isDeletedFirebaseAccount(anyString())).thenAnswer(i -> deletedUids.contains(i.<String>getArgument(0)));
        return new ProposalFirestoreImporter(rows, users, generator, Clock.fixed(NOW, ZoneOffset.UTC),
            ContentHmac.fromJwtSecret(secret));
    }

    private static User user(String uid, UUID id) {
        var u = new User(id, uid + "@example.test", null);
        u.setFirebaseUid(uid);
        return u;
    }

    private static Map<String, Object> doc(Object... kv) {
        var m = new HashMap<String, Object>();
        m.put("title", "Título");
        m.put("authorized", 1);
        m.put("author", "uid-author");
        m.put("dateTime", "2024-05-01T12:00:00.000Z");
        for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
        return m;
    }

    // A proposal removed by its author's account deletion is not brought back
    // by a re-run; one the deletion kept (APPROVED, detached) still gets new
    // activity.
    @Test
    void proposalOfADeletedAccountIsNotRecreated() {
        deletedUids.add("uid-gone");

        var outcome = importer.importProposal("doc-gone", doc("author", "uid-gone"), warnings);

        assertThat(outcome).isEqualTo(Outcome.SKIPPED);
        assertThat(rows.proposals).isEmpty();
        assertThat(warnings).contains("author deleted their account; proposal not re-imported")
            .doesNotContain("author not imported; proposal kept without author");

        warnings.clear();
        rows.existing.add(ProposalFirestoreImporter.proposalId("doc-gone"));
        rows.proposalIsNew = false;
        importer.importProposal("doc-gone", doc("author", "uid-gone"), warnings);
        assertThat(rows.proposals).hasSize(1);
        assertThat(rows.proposals.get(0).authorId()).isNull();
        assertThat(warnings).contains("author not imported; proposal kept without author");
    }

    // ------------------------------------------------------------- fields

    @Test
    void topicsMatchIgnoringCaseAccentsAndSpaces() {
        assertThat(ProposalFirestoreImporter.topic("Vida universitaria", warnings)).isEqualTo(ProposalTopic.VIDA_UNIVERSITARIA);
        assertThat(ProposalFirestoreImporter.topic(" vída-Universitaria ", warnings)).isEqualTo(ProposalTopic.VIDA_UNIVERSITARIA);
        assertThat(ProposalFirestoreImporter.topic("CEITBA", warnings)).isEqualTo(ProposalTopic.CEITBA);
        assertThat(ProposalFirestoreImporter.topic("Eventos", warnings)).isEqualTo(ProposalTopic.EVENTOS);
        assertThat(ProposalFirestoreImporter.topic("cursos", warnings)).isEqualTo(ProposalTopic.CURSOS);
        assertThat(ProposalFirestoreImporter.topic("Otros", warnings)).isEqualTo(ProposalTopic.OTROS);
        assertThat(warnings).isEmpty();

        assertThat(ProposalFirestoreImporter.topic("Deportes", warnings)).isEqualTo(ProposalTopic.OTROS);
        assertThat(ProposalFirestoreImporter.topic(null, warnings)).isEqualTo(ProposalTopic.OTROS);
        assertThat(warnings).containsExactly("unknown topic; filed under OTROS", "missing topic; filed under OTROS");
    }

    @Test
    void authorizedMapsToModerationStatus() {
        assertThat(ProposalFirestoreImporter.moderation(0)).isEqualTo(ProposalStatus.PENDING);
        assertThat(ProposalFirestoreImporter.moderation(1)).isEqualTo(ProposalStatus.APPROVED);
        assertThat(ProposalFirestoreImporter.moderation(2L)).isEqualTo(ProposalStatus.REJECTED);
        assertThat(ProposalFirestoreImporter.moderation(1.0)).isEqualTo(ProposalStatus.APPROVED);
        assertThat(ProposalFirestoreImporter.moderation(" 2 ")).isEqualTo(ProposalStatus.REJECTED);
        for (Object bad : new Object[] {3, -1, 1.5, "sí", null, true}) {
            assertThatThrownBy(() -> ProposalFirestoreImporter.moderation(bad))
                .as(String.valueOf(bad))
                .isInstanceOf(FirestoreImportException.class)
                .hasMessage("authorized must be 0, 1 or 2");
        }
    }

    @Test
    void statusMapsToLifecycle() {
        assertThat(ProposalFirestoreImporter.lifecycle("Abierto", warnings)).isEqualTo(ProposalLifecycle.ABIERTO);
        assertThat(ProposalFirestoreImporter.lifecycle("ACEPTADO", warnings)).isEqualTo(ProposalLifecycle.ACEPTADO);
        assertThat(ProposalFirestoreImporter.lifecycle("cerrado", warnings)).isEqualTo(ProposalLifecycle.CERRADO);
        assertThat(ProposalFirestoreImporter.lifecycle(null, warnings)).isEqualTo(ProposalLifecycle.ABIERTO);
        assertThat(warnings).isEmpty();
        assertThat(ProposalFirestoreImporter.lifecycle("Rechazado", warnings)).isEqualTo(ProposalLifecycle.ABIERTO);
        assertThat(warnings).containsExactly("unknown status; imported as ABIERTO");
    }

    @Test
    void timesAcceptIsoStringsAndRawTimestamps() {
        assertThat(ProposalFirestoreImporter.time("2024-05-01T12:00:00.000Z")).isEqualTo(CREATED);
        assertThat(ProposalFirestoreImporter.time(Map.of("_seconds", CREATED.toEpochSecond(), "_nanoseconds", 0)))
            .isEqualTo(CREATED);
        assertThat(ProposalFirestoreImporter.time(Map.of("seconds", CREATED.toEpochSecond()))).isEqualTo(CREATED);
        assertThat(ProposalFirestoreImporter.time("ayer")).isNull();
        assertThat(ProposalFirestoreImporter.time(" ")).isNull();
        assertThat(ProposalFirestoreImporter.time(123)).isNull();
        assertThat(ProposalFirestoreImporter.time(Map.of("x", 1))).isNull();
    }

    @Test
    void onlyCopiedLegacyKeysAreAttachmentKeys() {
        var p = ProposalFirestoreImporter.LEGACY_ATTACHMENT_KEY;
        assertThat(p.matcher(LEGACY_KEY).matches()).isTrue();
        assertThat(p.matcher("proposals/legacy/0f8e2a4c-1b3d-4e5f-8a7b-9c0d1e2f3a4b.pdf").matches()).isTrue();
        assertThat(p.matcher("proposals/legacy/0f8e2a4c-1b3d-4e5f-8a7b-9c0d1e2f3a4b.exe").matches()).isFalse();
        assertThat(p.matcher("proposals/0f8e2a4c-1b3d-4e5f-8a7b-9c0d1e2f3a4b-0123456789abcdef.png")
            .matches()).isFalse();
        assertThat(p.matcher("https://firebasestorage.example.test/v0/b/app/o/Propuestas%2F1.jpg").matches()).isFalse();
        assertThat(p.matcher("proposals/legacy/../media/x.png").matches()).isFalse();
    }

    @Test
    void cutNeverSplitsASurrogatePair() {
        assertThat(ProposalFirestoreImporter.cut("abc", 5)).isEqualTo("abc");
        assertThat(ProposalFirestoreImporter.cut("ab😀", 3)).isEqualTo("ab");
        assertThat(ProposalFirestoreImporter.cut("abcd", 3)).isEqualTo("abc");
    }

    @Test
    void commentsFlattenToOneLevelWithStableKeys() {
        var raw = List.of(
            Map.of("author", "a", "comment", "top", "dateTime", "2024-05-02T00:00:00Z",
                "replies", List.of(
                    Map.of("author", "b", "comment", "r1", "dateTime", "2024-05-03T00:00:00Z",
                        "replies", List.of(Map.of("author", "c", "comment", "deep"))),
                    Map.of("author", "b", "comment", "r1 again", "dateTime", "2024-05-03T00:00:00Z"))),
            "not a map");

        var flat = ProposalFirestoreImporter.flattenComments(raw, CREATED);

        assertThat(flat).extracting(ProposalFirestoreImporter.LegacyComment::body)
            .containsExactly("top", "r1", "deep", "r1 again");
        assertThat(flat).extracting(ProposalFirestoreImporter.LegacyComment::parentIndex)
            .containsExactly(null, 0, 0, 0);
        assertThat(flat.get(2).at()).isEqualTo(CREATED); // no dateTime: falls back
        assertThat(flat).extracting(ProposalFirestoreImporter.LegacyComment::key).doesNotHaveDuplicates();
        assertThat(ProposalFirestoreImporter.flattenComments(raw, CREATED)).isEqualTo(flat);
        assertThat(ProposalFirestoreImporter.flattenComments("nope", CREATED)).isEmpty();
    }

    // ------------------------------------------------------------ importing

    @Test
    void newDocumentIsInsertedWithMappedFieldsAndChildRows() {
        var d = doc(
            "description", "d", "topic", "Eventos", "status", "Cerrado", "mod", "uid-voter",
            "votes", Map.of("uid-voter", Map.of("like", false, "timestamp", "2024-05-02T00:00:00Z"),
                            "uid-ghost", Map.of("like", true),
                            "uid-author", Map.of("like", "maybe")),
            "comments", List.of(Map.of("author", "uid-voter", "comment", "hola", "dateTime", "2024-05-03T00:00:00Z")),
            "userNames", Map.of("uid-author", "AlfaRojo", "uid-ghost", "Fantasma"),
            "filesURL", List.of("https://img.example.test/o/Propuestas%2F1.jpg", LEGACY_KEY, "ftp://x/y.jpg", "", 7));

        Outcome outcome = importer.importProposal("doc-1", d, warnings);

        assertThat(outcome).isEqualTo(Outcome.CREATED);
        UUID id = ProposalFirestoreImporter.proposalId("doc-1");
        assertThat(rows.proposals).containsExactly(
            new ProposalRow(id, author, "Título", "d", "EVENTOS", "APPROVED", "CERRADO", null, voter, CREATED));
        assertThat(rows.locked).isEmpty();
        assertThat(rows.aliases).containsExactly(
            new AliasRow(id, author, "AlfaRojo"), new AliasRow(id, voter, "GeneradoUno"));
        assertThat(rows.votes).containsExactly(
            new VoteRow(id, voter, "DOWN", OffsetDateTime.parse("2024-05-02T00:00:00Z")));
        assertThat(rows.comments).singleElement().satisfies(c -> {
            assertThat(c.proposalId()).isEqualTo(id);
            assertThat(c.authorId()).isEqualTo(voter);
            assertThat(c.parentId()).isNull();
            assertThat(c.body()).isEqualTo("hola");
            assertThat(c.at()).isEqualTo(OffsetDateTime.parse("2024-05-03T00:00:00Z"));
        });
        assertThat(rows.attachments).containsExactly(
            new AttachmentRow(id, 0, LEGACY_KEY, "image/png"));
        assertThat(rows.recomputed).containsExactly(id);
        assertThat(warnings).containsExactlyInAnyOrder(
            "1 votes by users not imported dropped",
            "1 malformed votes dropped",
            "1 filesURL entries not copied to R2 dropped (re-export with --copy-attachments)",
            "1 malformed filesURL entries dropped");
    }

    @Test
    void idsAreStableAcrossRuns() {
        assertThat(ProposalFirestoreImporter.proposalId("doc-1")).isEqualTo(ProposalFirestoreImporter.proposalId("doc-1"))
            .isNotEqualTo(ProposalFirestoreImporter.proposalId("doc-2"));

        var d = doc("comments", List.of(Map.of("author", "uid-voter", "comment", "hola", "dateTime", "2024-05-03T00:00:00Z")));
        importer.importProposal("doc-1", d, warnings);
        importer.importProposal("doc-1", d, warnings);
        assertThat(rows.comments).hasSize(2);
        assertThat(rows.comments.get(0).id()).isEqualTo(rows.comments.get(1).id());
    }

    // Comment ids are public (the API returns them) and their inputs are not
    // secret (legacy document ids, Firebase uids, dateTime = createdAt), so
    // they must not be a plain hash of those inputs.
    @Test
    void commentIdsCannotBeRecomputedFromTheirInputs() {
        var d = doc("comments", List.of(
            Map.of("author", "uid-voter", "comment", "hola", "dateTime", "2024-05-03T00:00:00Z",
                "replies", List.of(Map.of("author", "uid-author", "comment", "r", "dateTime", "2024-05-04T00:00:00Z")))));
        importer.importProposal("doc-1", d, warnings);
        var flat = ProposalFirestoreImporter.flattenComments(d.get("comments"), CREATED);
        assertThat(rows.comments).hasSize(2);

        for (int i = 0; i < flat.size(); i++) {
            UUID id = rows.comments.get(i).id();
            String key = flat.get(i).key();
            for (String plain : List.of(
                    "firestore:propuestas:doc-1:comment:" + key,
                    "firestore-comment:doc-1:" + key,
                    "doc-1:" + key, key)) {
                assertThat(id).isNotEqualTo(UUID.nameUUIDFromBytes(plain.getBytes(StandardCharsets.UTF_8)));
            }
            assertThat(id.version()).isEqualTo(4);
        }

        // Keyed: another secret gives other ids for the same comments.
        var first = rows.comments.stream().map(CommentRow::id).toList();
        rows = new RecordingRows();
        importer("b3RoZXItand0LXNlY3JldC1rZXktMzJieXRlcy1sb25nIQ==").importProposal("doc-1", d, warnings);
        assertThat(rows.comments).extracting(CommentRow::id).doesNotContainAnyElementsOf(first);
    }

    @Test
    void existingDocumentIsLockedAndReportsWhetherRowsWereAdded() {
        rows.proposalIsNew = false;
        rows.voteIsNew = false;
        UUID id = ProposalFirestoreImporter.proposalId("doc-1");
        rows.existingAliases.put(id, Map.of(author, "AlfaRojo"));

        var d = doc("votes", Map.of("uid-voter", Map.of("like", true)));
        assertThat(importer.importProposal("doc-1", d, warnings)).isEqualTo(Outcome.SKIPPED);
        assertThat(rows.locked).containsExactly(id);
        assertThat(rows.aliases).isEmpty();

        rows.voteIsNew = true;
        assertThat(importer.importProposal("doc-1", d, warnings)).isEqualTo(Outcome.UPDATED);
    }

    @Test
    void takenOrOverlongAliasesAreReplaced() {
        UUID id = ProposalFirestoreImporter.proposalId("doc-1");
        rows.existingAliases.put(id, Map.of(UUID.randomUUID(), "AlfaRojo"));

        importer.importProposal("doc-1", doc("userNames", Map.of(
            "uid-author", "AlfaRojo",
            "uid-voter", "x".repeat(41))), warnings);

        assertThat(rows.aliases).containsExactly(
            new AliasRow(id, author, "GeneradoUno"), new AliasRow(id, voter, "GeneradoDos"));
        assertThat(generator.takenSeen).containsExactly(Set.of("AlfaRojo"), Set.of("AlfaRojo", "GeneradoUno"));
    }

    @Test
    void rejectedKeepsItsReasonAndPendingHasNoModerator() {
        importer.importProposal("doc-r", doc("authorized", 2, "rejectionReason", " Duplicada ", "mod", "uid-voter"), warnings);
        importer.importProposal("doc-p", doc("authorized", 0, "rejectionReason", "no aplica", "mod", "uid-voter"), warnings);

        assertThat(rows.proposals.get(0)).satisfies(p -> {
            assertThat(p.status()).isEqualTo("REJECTED");
            assertThat(p.rejectionReason()).isEqualTo("Duplicada");
            assertThat(p.moderatedBy()).isEqualTo(voter);
        });
        assertThat(rows.proposals.get(1)).satisfies(p -> {
            assertThat(p.status()).isEqualTo("PENDING");
            assertThat(p.rejectionReason()).isNull();
            assertThat(p.moderatedBy()).isNull();
        });
    }

    @Test
    void missingAuthorDateAndLongTextAreWarnedNotFatal() {
        var d = doc("author", "uid-ghost", "dateTime", null,
            "title", "t".repeat(120), "description", "d".repeat(5001));

        assertThat(importer.importProposal("doc-1", d, warnings)).isEqualTo(Outcome.CREATED);

        assertThat(rows.proposals).singleElement().satisfies(p -> {
            assertThat(p.authorId()).isNull();
            assertThat(p.title()).isEqualTo("t".repeat(100));
            assertThat(p.description()).isEqualTo("d".repeat(5000));
            assertThat(p.topic()).isEqualTo("OTROS");
            assertThat(p.createdAt()).isEqualTo(OffsetDateTime.ofInstant(NOW, ZoneOffset.UTC));
        });
        assertThat(warnings).containsExactlyInAnyOrder(
            "title longer than 100 characters truncated",
            "description longer than 5000 characters truncated",
            "missing topic; filed under OTROS",
            "missing or invalid dateTime; import time used",
            "author not imported; proposal kept without author");
        assertThat(rows.aliases).isEmpty();
    }

    @Test
    void missingTitleIsAnError() {
        assertThatThrownBy(() -> importer.importProposal("doc-1", doc("title", "  "), warnings))
            .isInstanceOf(FirestoreImportException.class).hasMessage("missing title");
        assertThat(rows.proposals).isEmpty();
    }

    @Test
    void commentsFromUnknownUsersBlankOnesAndLongOnes() {
        var replies = List.of(Map.of("author", "uid-author", "comment", "respuesta"));
        var d = doc("comments", List.of(
            Map.of("author", "uid-ghost", "comment", "anónimo"),
            Map.of("author", "uid-voter", "comment", " "),                      // dropped
            Map.of("author", "uid-voter", "comment", "", "replies", replies),   // tombstone anchor
            Map.of("author", "uid-voter", "comment", "c".repeat(1001))));

        importer.importProposal("doc-1", d, warnings);

        assertThat(rows.tombstones).singleElement().satisfies(t -> assertThat(t.parentId()).isNull());
        UUID anchor = rows.tombstones.get(0).id();
        assertThat(rows.comments).extracting(CommentRow::body, CommentRow::authorId, CommentRow::parentId)
            .containsExactly(
                org.assertj.core.groups.Tuple.tuple("anónimo", null, null),
                org.assertj.core.groups.Tuple.tuple("respuesta", author, anchor),
                org.assertj.core.groups.Tuple.tuple("c".repeat(1000), voter, null));
        assertThat(warnings).contains(
            "1 comments by users not imported kept without author",
            "2 blank comments dropped",
            "1 comments longer than 1000 characters truncated");
    }

    @Test
    void nonMapVotesAreIgnoredWithAWarning() {
        importer.importProposal("doc-1", doc("votes", 3), warnings);
        assertThat(rows.votes).isEmpty();
        assertThat(warnings).contains("votes is not a map; ignored");
    }

    @Test
    void isAlwaysAvailable() {
        assertThat(importer.isAvailable()).isTrue();
    }
}
