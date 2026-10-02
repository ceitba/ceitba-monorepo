package org.ceitba.api.web.drive;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.ceitba.api.domain.Subject;
import org.ceitba.api.domain.drive.DriveSourceStatus;
import org.ceitba.api.external.drive.FakeDriveClient;
import org.ceitba.api.repository.SubjectRepository;
import org.ceitba.api.repository.drive.DriveFileRepository;
import org.ceitba.api.repository.drive.DriveSourceRepository;
import org.ceitba.api.service.drive.DriveSyncService;
import org.ceitba.api.service.media.InMemoryObjectStorage;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Drive sync end to end against FakeDriveClient and an in-memory object
// store: register -> sync -> suggestions -> approval/publication -> reader
// endpoints, change detection (rename/move/edit/remove/revoke), cross-source
// moves, registration errors, reports and account deletion.
@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
@Import(InMemoryObjectStorage.Config.class)
@TestPropertySource(properties = {
    "auth.allowed-domains=itba.edu.ar",
    "itba.api.use-fake=true",
    "drive-sync.use-fake=true"
})
class DriveSyncIT {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @DynamicPropertySource
    static void datasourceProps(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
    }

    static final String ALUMNO = "alumno1@itba.edu.ar";
    static final String ROOT = "root-alumno1-0001";
    static final String FIS = "folder-fisica-0001";
    static final String MISC = "folder-varios-0001";
    static final String DOC = "doc-resumen-00001";
    static final String PDF = "pdf-tp1-000000001";
    static final String FOREIGN = "pdf-catedra-00001";
    static final String IMG = "img-pizarron-0001";

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired FakeDriveClient drive;
    @Autowired InMemoryObjectStorage storage;
    @Autowired DriveSyncService sync;
    @Autowired DriveSourceRepository sources;
    @Autowired DriveFileRepository files;
    @Autowired SubjectRepository subjects;

    @BeforeEach
    void seed() {
        jdbc.execute("TRUNCATE wiki.drive_unclaimed_share, wiki.drive_file_report, wiki.drive_file, "
            + "wiki.drive_source, public.\"user\", public.subject CASCADE");
        drive.reset();
        storage.clear();
        subjects.saveAll(List.of(
            new Subject("93.41", "Física I", 6),
            new Subject("93.42", "Física II", 6),
            new Subject("93.26", "Análisis Matemático I", 6),
            new Subject("72.31", "Programación Imperativa", 6)));

        drive.folder(ROOT, "Apuntes de Alumno", null, ALUMNO)
            .folder(FIS, "Física I", ROOT, ALUMNO)
            .doc(DOC, "Resumen cinemática", FIS, ALUMNO,
                "<html><body><p class=\"c1\">MRU uniforme</p><img src=\"images/image1.png\"><script>x()</script></body></html>",
                Map.of("image1.png", FakeDriveClient.tinyPng()))
            .file(PDF, "TP1.pdf", "application/pdf", FIS, ALUMNO, FakeDriveClient.pdf("Vectores y escalares"))
            .file(FOREIGN, "Guia catedra.pdf", "application/pdf", FIS, "catedra@itba.edu.ar",
                FakeDriveClient.pdf("Guia de ejercicios"))
            .folder(MISC, "Varios", ROOT, ALUMNO)
            .file(IMG, "pizarron.png", "image/png", MISC, ALUMNO, FakeDriveClient.tinyPng())
            .file("form-encuesta-0001", "Encuesta", "application/vnd.google-apps.form", ROOT, ALUMNO, null)
            .shortcut("shortcut-tp1-0001", "Atajo TP1", MISC, ALUMNO, PDF);
    }

    // ---- helpers ---------------------------------------------------------

    static RequestPostProcessor as(String email, String... roles) {
        var authorities = new ArrayList<org.springframework.security.core.GrantedAuthority>();
        authorities.add(new SimpleGrantedAuthority("ROLE_USER"));
        for (var r : roles) authorities.add(new SimpleGrantedAuthority("ROLE_" + r));
        String name = email.equals(ALUMNO) ? "Alumno Uno" : email;
        return jwt().jwt(t -> t.claim("email", email).claim("name", name)).authorities(authorities);
    }

    static RequestPostProcessor student() { return as(ALUMNO); }
    static RequestPostProcessor reader(int n) { return as("lector" + n + "@itba.edu.ar"); }
    static RequestPostProcessor staff() { return as("staff@itba.edu.ar", "STAFF"); }

    ResultActions call(MockHttpServletRequestBuilder req, RequestPostProcessor who, String body) throws Exception {
        if (body != null) req.contentType(MediaType.APPLICATION_JSON).content(body);
        return mvc.perform(req.with(who));
    }

    JsonNode read(ResultActions r) throws Exception {
        return json.readTree(r.andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8));
    }

    UUID register(String folder, RequestPostProcessor who) throws Exception {
        var res = call(post("/v1/me/drive/sources"), who,
            "{\"folderUrl\":\"https://drive.google.com/drive/folders/" + folder + "?usp=sharing\","
                + "\"consentVersion\":\"2026-10\",\"anonymous\":false}")
            .andExpect(status().isCreated());
        var id = UUID.fromString(read(res).get("id").asText());
        // Registration queues an async sync; wait for it to finish.
        await().atMost(Duration.ofSeconds(20)).until(() -> sources.findById(id).orElseThrow().getLastSyncedAt() != null);
        return id;
    }

    // Runs a sync now (retrying while an async one still holds the source).
    DriveSyncService.Outcome syncNow(UUID sourceId) {
        var out = new DriveSyncService.Outcome[1];
        await().atMost(Duration.ofSeconds(20)).until(() -> {
            out[0] = sync.syncSource(sourceId);
            return out[0] != DriveSyncService.Outcome.SKIPPED;
        });
        return out[0];
    }

    JsonNode tree(UUID sourceId) throws Exception {
        return read(call(get("/v1/me/drive/sources/" + sourceId + "/tree"), student(), null).andExpect(status().isOk()));
    }

    static JsonNode item(JsonNode tree, String name) {
        for (var i : tree.get("items")) if (i.get("name").asText().equals(name)) return i;
        throw new AssertionError("no item " + name + " in " + tree);
    }

    UUID fileId(String driveId) {
        return files.findAll().stream().filter(f -> f.getDriveId().equals(driveId)).findFirst().orElseThrow().getId();
    }

    // Registered, approved and with Física I assigned to its folder.
    UUID publishedSource() throws Exception {
        var sourceId = register(ROOT, student());
        call(post("/v1/staff/drive/sources/" + sourceId + "/approve"), staff(), null).andExpect(status().isOk());
        call(patch("/v1/me/drive/files/" + fileId(FIS)), student(), "{\"subjectId\":\"93.41\"}").andExpect(status().isOk());
        return sourceId;
    }

    // ---- register -> sync -> publish -> read ---------------------------

    @Test
    void registerSyncSuggestApprovePublishAndRead() throws Exception {
        call(get("/v1/me/drive/info"), student(), null)
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.botEmail").value(FakeDriveClient.BOT_EMAIL))
            .andExpect(jsonPath("$.consentVersion").value("2026-10"));

        var sourceId = register(ROOT, student());
        var t = tree(sourceId);
        assertThat(t.get("source").get("status").asText()).isEqualTo("PENDING_REVIEW");
        assertThat(t.get("source").get("rootName").asText()).isEqualTo("Apuntes de Alumno");
        // 2 folders + 4 files; the form is skipped and the shortcut to TP1 is deduplicated.
        assertThat(t.get("items")).hasSize(6);
        assertThat(t.get("source").get("fileCount").asLong()).isEqualTo(4);
        var fis = item(t, "Física I");
        assertThat(fis.get("kind").asText()).isEqualTo("FOLDER");
        assertThat(fis.get("suggestedSubjectId").asText()).isEqualTo("93.41");
        assertThat(fis.get("suggestedSubjectName").asText()).isEqualTo("Física I");
        assertThat(item(t, "TP1.pdf").get("parentId").asText()).isEqualTo(fis.get("id").asText());
        assertThat(item(t, "Varios").get("parentId").isNull()).isTrue();
        assertThat(item(t, "TP1.pdf").get("publication").asText()).isEqualTo("PRIVATE");
        assertThat(item(t, "Guia catedra.pdf").get("ownedByMe").asBoolean()).isFalse();

        call(post("/v1/me/drive/sources/" + sourceId + "/accept-suggestions"), student(), null)
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.applied").value(1));
        t = tree(sourceId);
        var doc = item(t, "Resumen cinemática");
        assertThat(doc.get("effectiveSubjectId").asText()).isEqualTo("93.41");
        assertThat(doc.get("subjectId").isNull()).isTrue();
        // Held while the source waits for staff.
        assertThat(doc.get("publication").asText()).isEqualTo("NEEDS_REVIEW");
        assertThat(t.get("source").get("needsReviewCount").asLong()).isEqualTo(3);

        // Not visible to readers yet, but the owner can preview it.
        var docId = doc.get("id").asText();
        call(get("/v1/wiki/files/" + docId), reader(1), null).andExpect(status().isNotFound());
        var preview = read(call(get("/v1/wiki/files/" + docId), student(), null).andExpect(status().isOk()));
        assertThat(preview.get("html").asText())
            .contains("<img src=\"/api/v1/wiki/files/" + docId + "/assets/image1.png\"")
            .doesNotContain("script", "class=");
        assertThat(preview.get("hasHtml").asBoolean()).isTrue();
        assertThat(preview.get("hasPdf").asBoolean()).isTrue();
        assertThat(preview.get("path").asText()).isEqualTo("Física I");
        // Stored copies live under drive/ only.
        assertThat(storage.keys()).isNotEmpty().allMatch(k -> k.startsWith("drive/"));
        // Text extracted for search.
        assertThat(files.findById(UUID.fromString(docId)).orElseThrow().getTextContent()).contains("MRU uniforme");
        assertThat(files.findById(fileId(PDF)).orElseThrow().getTextContent()).contains("Vectores");

        // Staff see the owner even before approval; approval publishes own files.
        call(get("/v1/staff/drive/sources?status=PENDING_REVIEW"), staff(), null)
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.total").value(1))
            .andExpect(jsonPath("$.items[0].ownerEmail").value(ALUMNO));
        call(post("/v1/staff/drive/sources/" + sourceId + "/approve"), staff(), "{\"comment\":\"ok\"}")
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("ACTIVE"))
            .andExpect(jsonPath("$.publishedCount").value(2))
            .andExpect(jsonPath("$.needsReviewCount").value(1));

        var subjectFiles = read(call(get("/v1/wiki/subjects/93.41/files"), reader(1), null).andExpect(status().isOk()));
        assertThat(subjectFiles.get("subjectName").asText()).isEqualTo("Física I");
        assertThat(subjectFiles.get("groups")).hasSize(1);
        var group = subjectFiles.get("groups").get(0);
        assertThat(group.get("author").get("name").asText()).isEqualTo("Alumno Uno");
        assertThat(group.get("author").get("anonymous").asBoolean()).isFalse();
        assertThat(group.get("files")).hasSize(2);
        assertThat(group.get("files").get(0).get("path").asText()).isEqualTo("Física I");

        // Downloads and Doc images redirect to short-lived signed URLs.
        call(get("/v1/wiki/files/" + fileId(PDF) + "/download"), reader(1), null)
            .andExpect(status().isFound())
            .andExpect(header().string("Location", org.hamcrest.Matchers.startsWith("https://storage.test/drive/")))
            .andExpect(header().string("Location", org.hamcrest.Matchers.containsString("ttl=300")));
        call(get("/v1/wiki/files/" + docId + "/assets/image1.png"), reader(1), null).andExpect(status().isFound());
        call(get("/v1/wiki/files/" + docId + "/assets/other.png"), reader(1), null).andExpect(status().isNotFound());
        call(get("/v1/wiki/files/" + docId + "/download?variant=original"), reader(1), null)
            .andExpect(status().isNotFound());

        // Anonymous sources hide the author from readers.
        call(patch("/v1/me/drive/sources/" + sourceId), student(), "{\"anonymous\":true}").andExpect(status().isOk());
        call(get("/v1/wiki/subjects/93.41/files"), reader(1), null)
            .andExpect(jsonPath("$.groups[0].author.name").doesNotExist())
            .andExpect(jsonPath("$.groups[0].author.anonymous").value(true));
        call(get("/v1/staff/drive/sources"), staff(), null)
            .andExpect(jsonPath("$.items[0].ownerName").value("Alumno Uno"));

        // The foreign file waits in the staff queue; publishing it sticks.
        call(get("/v1/staff/drive/files?publication=NEEDS_REVIEW"), staff(), null)
            .andExpect(jsonPath("$.total").value(1))
            .andExpect(jsonPath("$.items[0].ownerEmail").value("catedra@itba.edu.ar"))
            .andExpect(jsonPath("$.items[0].sharerEmail").value(ALUMNO));
        call(post("/v1/staff/drive/files/" + fileId(FOREIGN) + "/publish"), staff(), null)
            .andExpect(jsonPath("$.publication").value("PUBLISHED"));
        syncNow(sourceId);
        assertThat(item(tree(sourceId), "Guia catedra.pdf").get("publication").asText()).isEqualTo("PUBLISHED");

        // Subject listings.
        call(get("/v1/wiki/apuntes/subjects"), reader(1), null)
            .andExpect(jsonPath("$[0].subjectId").value("93.41"))
            .andExpect(jsonPath("$[0].fileCount").value(3));
        var search = read(call(get("/v1/wiki/apuntes/subjects?q=fisica"), reader(1), null).andExpect(status().isOk()));
        assertThat(search).hasSize(2);
        assertThat(search.get(0).get("subjectId").asText()).isEqualTo("93.41");
        assertThat(search.get(1).get("fileCount").asLong()).isZero();

        // Hiding a folder hides what is in it.
        call(patch("/v1/me/drive/files/" + fileId(FIS)), student(), "{\"hidden\":true}")
            .andExpect(jsonPath("$.hidden").value(true));
        assertThat(item(tree(sourceId), "TP1.pdf").get("publication").asText()).isEqualTo("PRIVATE");
        call(patch("/v1/me/drive/files/" + fileId(FIS)), student(), "{\"hidden\":false,\"subjectId\":\"\"}")
            .andExpect(jsonPath("$.subjectId").doesNotExist());
        assertThat(item(tree(sourceId), "TP1.pdf").get("publication").asText()).isEqualTo("PRIVATE");
        call(patch("/v1/me/drive/files/" + fileId(FIS)), student(), "{\"subjectId\":\"99.99\"}")
            .andExpect(status().isBadRequest());
    }

    // ---- change detection ------------------------------------------------

    @Test
    void renameMoveEditRemoveAndRevoke() throws Exception {
        var sourceId = publishedSource();
        var docId = fileId(DOC);
        var pdfId = fileId(PDF);
        int docFetches = drive.fetchCount(DOC);
        int pdfFetches = drive.fetchCount(PDF);
        var docRow = files.findById(docId).orElseThrow();
        var docFingerprint = docRow.getContentFingerprint();
        var docKeys = docRow.storageKeys();
        int puts = storage.putCount();
        assertThat(docFetches).isEqualTo(2); // zip + pdf
        assertThat(pdfFetches).isEqualTo(1);

        // Rename a Doc: modifiedTime moves, so it is exported again, but the
        // content hash is unchanged: same id, no new objects, no PDF export.
        drive.rename(DOC, "Resumen cinemática v2");
        assertThat(syncNow(sourceId)).isEqualTo(DriveSyncService.Outcome.SYNCED);
        var renamed = files.findById(docId).orElseThrow();
        assertThat(renamed.getName()).isEqualTo("Resumen cinemática v2");
        assertThat(renamed.getContentFingerprint()).isEqualTo(docFingerprint);
        assertThat(renamed.storageKeys()).isEqualTo(docKeys);
        assertThat(drive.fetchCount(DOC)).isEqualTo(docFetches + 1);
        assertThat(storage.putCount()).isEqualTo(puts);

        // Rename a binary: md5 unchanged, nothing fetched.
        drive.rename(PDF, "TP1 resuelto.pdf");
        syncNow(sourceId);
        assertThat(files.findById(pdfId).orElseThrow().getName()).isEqualTo("TP1 resuelto.pdf");
        assertThat(drive.fetchCount(PDF)).isEqualTo(pdfFetches);

        // Move the PDF to Varios: path and subject change, no refetch.
        drive.move(PDF, MISC);
        syncNow(sourceId);
        var moved = item(tree(sourceId), "TP1 resuelto.pdf");
        assertThat(moved.get("id").asText()).isEqualTo(pdfId.toString());
        assertThat(moved.get("parentId").asText()).isEqualTo(fileId(MISC).toString());
        assertThat(moved.get("effectiveSubjectId").isNull()).isTrue();
        assertThat(moved.get("publication").asText()).isEqualTo("PRIVATE");
        assertThat(drive.fetchCount(PDF)).isEqualTo(pdfFetches);
        call(patch("/v1/me/drive/files/" + pdfId), student(), "{\"subjectId\":\"93.42\"}")
            .andExpect(jsonPath("$.publication").value("PUBLISHED"));
        call(get("/v1/wiki/files/" + pdfId), reader(1), null)
            .andExpect(jsonPath("$.path").value("Varios"))
            .andExpect(jsonPath("$.subjectId").value("93.42"));

        // Edit the Doc: new content -> new objects, old ones deleted.
        drive.updateDoc(DOC, "<html><body><p>MRUV acelerado</p></body></html>");
        syncNow(sourceId);
        var edited = files.findById(docId).orElseThrow();
        assertThat(edited.getContentFingerprint()).isNotEqualTo(docFingerprint);
        assertThat(edited.getTextContent()).contains("MRUV acelerado");
        assertThat(edited.getAssetNames()).isEmpty();
        assertThat(drive.fetchCount(DOC)).isEqualTo(docFetches + 3);
        assertThat(storage.keys()).doesNotContainAnyElementsOf(docKeys).containsAll(edited.storageKeys());

        // Gone from Drive: REMOVED after a complete walk, purge scheduled.
        drive.remove(IMG);
        syncNow(sourceId);
        var removed = files.findById(fileId(IMG)).orElseThrow();
        assertThat(removed.getPublication().name()).isEqualTo("REMOVED");
        assertThat(removed.getPurgeAfter()).isNotNull();

        // Unshared: REVOKED, nothing published.
        drive.revoke(ROOT);
        assertThat(syncNow(sourceId)).isEqualTo(DriveSyncService.Outcome.REVOKED);
        assertThat(sources.findById(sourceId).orElseThrow().getStatus()).isEqualTo(DriveSourceStatus.REVOKED);
        call(get("/v1/wiki/subjects/93.41/files"), reader(1), null).andExpect(jsonPath("$.groups").isEmpty());
        call(get("/v1/wiki/files/" + pdfId), reader(1), null).andExpect(status().isNotFound());
    }

    @Test
    void crossSourceMoveKeepsTheRowWhicheverSourceSyncsFirst() throws Exception {
        var a = publishedSource();
        drive.folder("root-alumno1-0002", "Segunda carpeta", null, ALUMNO);
        var b = register("root-alumno1-0002", student());
        // A student with an ACTIVE folder is trusted.
        assertThat(sources.findById(b).orElseThrow().getStatus()).isEqualTo(DriveSourceStatus.ACTIVE);

        var pdfId = fileId(PDF);
        call(patch("/v1/me/drive/files/" + pdfId), student(), "{\"subjectId\":\"93.42\"}").andExpect(status().isOk());
        int fetches = drive.fetchCount(PDF);

        // (The shortcut in Varios would keep the PDF reachable from A.)
        drive.remove("shortcut-tp1-0001");
        // Old source first: A marks it removed, B adopts the same row.
        drive.move(PDF, "root-alumno1-0002");
        syncNow(a);
        assertThat(files.findById(pdfId).orElseThrow().getPublication().name()).isEqualTo("REMOVED");
        syncNow(b);
        var adopted = files.findById(pdfId).orElseThrow();
        assertThat(adopted.getSourceId()).isEqualTo(b);
        assertThat(adopted.getSubjectId()).isEqualTo("93.42");
        assertThat(adopted.getPublication().name()).isEqualTo("PUBLISHED");
        assertThat(adopted.getParentDriveId()).isNull();

        // New source first: A inserts a row, then B hands over its older one.
        drive.move(PDF, FIS);
        syncNow(a);
        syncNow(b);
        var back = files.findById(pdfId).orElseThrow();
        assertThat(back.getSourceId()).isEqualTo(a);
        assertThat(back.getParentDriveId()).isEqualTo(FIS);
        assertThat(back.getSubjectId()).isEqualTo("93.42");
        assertThat(files.findAll().stream().filter(f -> f.getDriveId().equals(PDF))).hasSize(1);
        assertThat(drive.fetchCount(PDF)).isEqualTo(fetches);
        assertThat(storage.keys()).containsAll(back.storageKeys());
    }

    // ---- registration errors ---------------------------------------------

    @Test
    void registrationErrors() throws Exception {
        String body = "{\"folderUrl\":\"%s\",\"consentVersion\":\"%s\",\"anonymous\":false}";
        call(post("/v1/me/drive/sources"), student(), body.formatted("https://example.com/x", "2026-10"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("DRIVE_INVALID_FOLDER_URL"));
        call(post("/v1/me/drive/sources"), student(), body.formatted("not-shared-folder-01", "2026-10"))
            .andExpect(status().isUnprocessableEntity())
            .andExpect(jsonPath("$.error").value("DRIVE_FOLDER_NOT_SHARED"));
        drive.folder("someone-elses-0001", "Ajena", null, "otro@itba.edu.ar");
        call(post("/v1/me/drive/sources"), student(), body.formatted("someone-elses-0001", "2026-10"))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error").value("DRIVE_FOLDER_NOT_OWNED"));
        call(post("/v1/me/drive/sources"), student(), body.formatted(DOC, "2026-10"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("DRIVE_INVALID_FOLDER_URL"));
        call(post("/v1/me/drive/sources"), student(), body.formatted(ROOT, "2020-01"))
            .andExpect(status().isBadRequest());

        var sourceId = register(ROOT, student());
        call(post("/v1/me/drive/sources"), student(), body.formatted(ROOT, "2026-10"))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error").value("DRIVE_SOURCE_EXISTS"));
        call(post("/v1/me/drive/sources/" + sourceId + "/sync"), student(), null)
            .andExpect(status().isTooManyRequests())
            .andExpect(jsonPath("$.error").value("DRIVE_SYNC_RATE_LIMITED"))
            .andExpect(header().exists("Retry-After"));
        // Someone else's source is invisible.
        call(get("/v1/me/drive/sources/" + sourceId + "/tree"), reader(1), null).andExpect(status().isNotFound());

        // Unclaimed shares show up for staff until registered.
        drive.folder("unclaimed-folder-01", "Sin registrar", null, "otro@itba.edu.ar");
        sync.runAll();
        call(get("/v1/staff/drive/unclaimed"), staff(), null)
            .andExpect(jsonPath("$[?(@.name == 'Sin registrar')].ownerEmail").value("otro@itba.edu.ar"))
            .andExpect(jsonPath("$[?(@.name == 'Apuntes de Alumno')]").isEmpty());
        call(get("/v1/staff/drive/unclaimed"), student(), null).andExpect(status().isForbidden());

        // Disconnect deletes the copies.
        assertThat(storage.keys()).isNotEmpty();
        call(delete("/v1/me/drive/sources/" + sourceId), student(), null).andExpect(status().isNoContent());
        assertThat(files.findBySourceId(sourceId)).isEmpty();
        assertThat(storage.keys()).isEmpty();
        call(get("/v1/me/drive/sources"), student(), null).andExpect(jsonPath("$").isEmpty());
        // ...and the folder can be connected again.
        register(ROOT, student());
    }

    // ---- reports -----------------------------------------------------------

    @Test
    void threeReportsHideAFileUntilStaffRestoresIt() throws Exception {
        publishedSource();
        var pdfId = fileId(PDF);
        String report = "{\"reason\":\"COPYRIGHT\",\"comment\":\"es del libro\"}";
        call(put("/v1/wiki/files/" + pdfId + "/report"), reader(1), report).andExpect(status().isNoContent());
        call(put("/v1/wiki/files/" + pdfId + "/report"), reader(1), report).andExpect(status().isNoContent());
        call(put("/v1/wiki/files/" + pdfId + "/report"), reader(2), "{\"reason\":\"SPAM\"}").andExpect(status().isNoContent());
        call(get("/v1/wiki/files/" + pdfId), reader(1), null).andExpect(jsonPath("$.reportedByMe").value(true));
        assertThat(files.findById(pdfId).orElseThrow().getPublication().name()).isEqualTo("PUBLISHED");
        call(put("/v1/wiki/files/" + pdfId + "/report"), reader(3), "{\"reason\":\"BOGUS\"}").andExpect(status().isBadRequest());

        call(put("/v1/wiki/files/" + pdfId + "/report"), reader(3), "{\"reason\":\"OTHER\"}").andExpect(status().isNoContent());
        assertThat(files.findById(pdfId).orElseThrow().getPublication().name()).isEqualTo("HIDDEN_REPORTED");
        call(get("/v1/wiki/files/" + pdfId), reader(4), null).andExpect(status().isNotFound());
        call(get("/v1/wiki/subjects/93.41/files"), reader(4), null)
            .andExpect(jsonPath("$.groups[0].files.length()").value(1));

        call(get("/v1/staff/drive/files?publication=HIDDEN_REPORTED"), staff(), null)
            .andExpect(jsonPath("$.total").value(1))
            .andExpect(jsonPath("$.items[0].reportCount").value(3))
            .andExpect(jsonPath("$.items[0].reports.length()").value(3));
        call(post("/v1/staff/drive/files/" + pdfId + "/restore"), staff(), null)
            .andExpect(jsonPath("$.publication").value("PUBLISHED"))
            .andExpect(jsonPath("$.reportCount").value(0));

        call(post("/v1/staff/drive/files/" + pdfId + "/remove"), staff(), null)
            .andExpect(jsonPath("$.publication").value("REMOVED_BY_STAFF"));
        call(get("/v1/wiki/files/" + pdfId), reader(4), null).andExpect(status().isNotFound());
    }

    // ---- account deletion -------------------------------------------------

    @Test
    void accountDeletionRemovesSourcesCopiesAndReports() throws Exception {
        publishedSource();
        var pdfId = fileId(PDF);
        for (int n = 1; n <= 3; n++) {
            call(put("/v1/wiki/files/" + pdfId + "/report"), reader(n), "{\"reason\":\"SPAM\"}").andExpect(status().isNoContent());
        }
        assertThat(files.findById(pdfId).orElseThrow().getPublication().name()).isEqualTo("HIDDEN_REPORTED");

        // A reporter leaves: the file is recounted and published again.
        call(delete("/v1/me"), reader(1), null).andExpect(status().is2xxSuccessful());
        var after = files.findById(pdfId).orElseThrow();
        assertThat(after.getReportCount()).isEqualTo(2);
        assertThat(after.getPublication().name()).isEqualTo("PUBLISHED");

        // The student leaves: sources, files and stored copies go.
        assertThat(storage.keys()).isNotEmpty();
        call(delete("/v1/me"), student(), null).andExpect(status().is2xxSuccessful());
        assertThat(sources.count()).isZero();
        assertThat(files.count()).isZero();
        assertThat(storage.keys()).isEmpty();
    }
}
