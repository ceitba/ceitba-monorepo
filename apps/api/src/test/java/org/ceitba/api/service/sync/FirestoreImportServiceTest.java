package org.ceitba.api.service.sync;

import org.ceitba.api.domain.BenefitCard;
import org.ceitba.api.domain.Career;
import org.ceitba.api.domain.CeitbaModerator;
import org.ceitba.api.domain.Plan;
import org.ceitba.api.domain.User;
import org.ceitba.api.domain.news.UserFollow;
import org.ceitba.api.repository.BenefitCardRepository;
import org.ceitba.api.repository.BenefitRepository;
import org.ceitba.api.repository.CareerRepository;
import org.ceitba.api.repository.CeitbaModeratorRepository;
import org.ceitba.api.repository.PlanRepository;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.repository.news.OrganizationRepository;
import org.ceitba.api.repository.news.UserFollowRepository;
import org.ceitba.api.service.news.FollowService;
import org.ceitba.api.service.news.OrganizationMembershipService;
import org.ceitba.api.service.sync.FirestoreImportReport.Outcome;
import org.ceitba.api.web.sync.dto.FirestoreBenefitDoc;
import org.ceitba.api.web.sync.dto.FirestoreExport;
import org.ceitba.api.web.sync.dto.FirestoreUserDoc;
import org.ceitba.api.web.sync.dto.FirestoreUserDoc.SocialMedia;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;

import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

// FirestoreImportService against in-memory Mockito repositories. The
// transaction manager hands out SimpleTransactionStatus objects so the tests
// can see which per-document transactions were marked rollback-only.
// All fixture people are synthetic (example.itba.edu.ar-style addresses).
class FirestoreImportServiceTest {

    private final Career careerS = new Career("S", "Ingeniería en Informática");
    private final Career careerPai = new Career("PAI", "Proceso de Admisión");
    private final Map<String, Career> careerTable = Map.of("S", careerS, "PAI", careerPai);

    private final Map<UUID, User> userRows = new HashMap<>();
    private final Map<UUID, CeitbaModerator> moderatorRows = new HashMap<>();
    private final List<BenefitCard> cardRows = new ArrayList<>();
    private final List<SimpleTransactionStatus> statuses = new ArrayList<>();

    private UserRepository users;
    private BenefitCardRepository cards;
    private UserFollowRepository followRows;
    private FirestoreProposalImporter proposals;
    private FirestoreImportService service;

    @BeforeEach
    void setup() {
        users = mock(UserRepository.class);
        var careers = mock(CareerRepository.class);
        var plans = mock(PlanRepository.class);
        var moderators = mock(CeitbaModeratorRepository.class);
        var categories = mock(BenefitRepository.class);
        cards = mock(BenefitCardRepository.class);
        // FollowService is a concrete class (not mockable on every JDK), so
        // use the real one over mocked repositories.
        followRows = mock(UserFollowRepository.class);
        var orgs = mock(OrganizationRepository.class);
        when(orgs.existsById("ceitba")).thenReturn(true);
        var follows = new FollowService(followRows, orgs, users);
        proposals = mock(FirestoreProposalImporter.class);
        var txManager = mock(PlatformTransactionManager.class);

        when(txManager.getTransaction(any())).thenAnswer(inv -> {
            var s = new SimpleTransactionStatus();
            statuses.add(s);
            return s;
        });

        when(careers.findAll()).thenReturn(List.of(careerS, careerPai));
        when(careers.getReferenceById(anyString())).thenAnswer(inv -> careerTable.get(inv.<String>getArgument(0)));
        when(plans.findAll()).thenReturn(List.of(
            new Plan("S10-Rev23", careerS, "S10-Rev23"),
            new Plan("PX-Current", careerPai, "PX-Current")));

        when(users.findByFirebaseUid(anyString())).thenAnswer(inv -> userRows.values().stream()
            .filter(u -> inv.getArgument(0).equals(u.getFirebaseUid())).findFirst());
        when(users.findFirstByEmailIgnoreCaseOrderByCreatedAtAsc(anyString())).thenAnswer(inv -> userRows.values()
            .stream().filter(u -> u.getEmail().equalsIgnoreCase(inv.getArgument(0))).findFirst());
        when(users.save(any(User.class))).thenAnswer(inv -> {
            User u = inv.getArgument(0);
            userRows.put(u.getId(), u);
            return u;
        });

        when(moderators.findById(any())).thenAnswer(inv -> Optional.ofNullable(moderatorRows.get(inv.<UUID>getArgument(0))));
        when(moderators.save(any(CeitbaModerator.class))).thenAnswer(inv -> {
            CeitbaModerator m = inv.getArgument(0);
            moderatorRows.put(m.getUserId(), m);
            return m;
        });

        when(categories.existsById(anyString())).thenAnswer(inv ->
            Set.of("convenios", "deportes", "idiomas").contains(inv.<String>getArgument(0)));
        when(cards.findByTitleEsIgnoreCase(anyString())).thenAnswer(inv -> cardRows.stream()
            .filter(c -> c.getTitleEs().equalsIgnoreCase(inv.getArgument(0))).toList());
        when(cards.save(any(BenefitCard.class))).thenAnswer(inv -> {
            BenefitCard c = inv.getArgument(0);
            if (!cardRows.contains(c)) cardRows.add(c);
            return c;
        });

        var clock = Clock.fixed(Instant.parse("2026-03-01T12:00:00Z"), ZoneOffset.UTC);
        service = new FirestoreImportService(users, careers, plans, moderators, categories, cards,
            follows, mock(OrganizationMembershipService.class), proposals, txManager, clock);
    }

    private static FirestoreUserDoc userDoc(String uid, String email, String degree, String plan) {
        return new FirestoreUserDoc(uid, email, "Alumno Prueba", degree, plan, false, null);
    }

    private static FirestoreExport users(FirestoreUserDoc... docs) {
        return new FirestoreExport(List.of(docs), null, null);
    }

    private static FirestoreExport benefits(FirestoreBenefitDoc... docs) {
        return new FirestoreExport(null, null, List.of(docs));
    }

    private static FirestoreBenefitDoc benefit(String title, String category, List<String> description) {
        return new FirestoreBenefitDoc("b-" + title.toLowerCase(Locale.ROOT), title, category, List.of(),
            "https://img.example.test/a.png", description, "Av. Siempreviva 742",
            "https://maps.example.test/x", "https://forms.example.test/x", "+54 11 0000-0000",
            "https://partner.example.test", "contacto@partner.example.test");
    }

    private User onlyUser() {
        assertThat(userRows).hasSize(1);
        return userRows.values().iterator().next();
    }

    // ---------------------------------------------------------------- users

    @Test
    void createsUserWithUidCareerPlanAndHandles() {
        var doc = new FirestoreUserDoc("uid-1", "Alumno.Uno@Example.test", "  Alumno Uno ",
            "Ingeniería en Informática", "S10-Rev23", false,
            new SocialMedia("https://www.linkedin.com/in/alumno-uno/", "@Alumno.Uno", "alumno_uno"));

        var report = service.importExport(users(doc), false);

        assertThat(report.getCreated()).isEqualTo(1);
        assertThat(report.getUsuarios().getCreated()).isEqualTo(1);
        assertThat(report.getErrors()).isEmpty();
        var u = onlyUser();
        assertThat(u.getEmail()).isEqualTo("alumno.uno@example.test");
        assertThat(u.getFirebaseUid()).isEqualTo("uid-1");
        assertThat(u.getName()).isEqualTo("Alumno Uno");
        assertThat(u.getCareer()).isSameAs(careerS);
        assertThat(u.getPlan()).isEqualTo("S10-Rev23");
        assertThat(u.getLinkedin()).isEqualTo("alumno-uno");
        assertThat(u.getInstagram()).isEqualTo("alumno.uno");
        assertThat(u.getDiscord()).isEqualTo("alumno_uno");
        verify(followRows).save(any(UserFollow.class));
        assertThat(statuses).allSatisfy(s -> assertThat(s.isRollbackOnly()).isFalse());
    }

    // The account was deleted through DELETE /v1/me: neither re-created nor
    // linked to a new account that signed in with the same email.
    @Test
    void deletedAccountIsNotReimported() {
        when(users.isDeletedFirebaseAccount("uid-gone")).thenReturn(true);
        var fresh = users.save(new User(UUID.randomUUID(), "gone@example.test", null));

        var report = service.importExport(users(userDoc("uid-gone", "gone@example.test", "S", null)), false);

        assertThat(report.getUsuarios().getSkipped()).isEqualTo(1);
        assertThat(report.getErrors()).isEmpty();
        assertThat(report.getWarnings()).extracting(FirestoreImportReport.Issue::message)
            .containsExactly("account was deleted in the new app; not re-imported");
        assertThat(userRows).containsOnlyKeys(fresh.getId());
        assertThat(fresh.getFirebaseUid()).isNull();
        assertThat(fresh.getCareer()).isNull();
    }

    @Test
    void careerMatchesByIdToo() {
        service.importExport(users(userDoc("uid-1", "a@example.test", "S", null)), false);
        assertThat(onlyUser().getCareer()).isSameAs(careerS);
        assertThat(onlyUser().getPlan()).isNull();
    }

    @Test
    void rerunIsIdempotent() {
        var export = users(new FirestoreUserDoc("uid-1", "a@example.test", "Alumno", "S", "S10-Rev23", true,
            new SocialMedia("", "alumno", "")));

        service.importExport(export, false);
        var second = service.importExport(export, false);

        assertThat(userRows).hasSize(1);
        assertThat(moderatorRows).hasSize(1);
        assertThat(second.getCreated()).isZero();
        assertThat(second.getUpdated()).isZero();
        assertThat(second.getSkipped()).isEqualTo(1);
        verify(followRows, times(1)).save(any(UserFollow.class));
    }

    @Test
    void unknownDegreeLeavesCareerAndPlanNull() {
        // Legacy entrance-program values the old app stored as degree/plan.
        service.importExport(users(userDoc("uid-1", "a@example.test", "ADM", "Ingreso")), false);

        var u = onlyUser();
        assertThat(u.getCareer()).isNull();
        assertThat(u.getPlan()).isNull();
    }

    @Test
    void planOutsideTheCareerCatalogueDropsTheCareerToo() {
        // A past year's entrance plan: the career still exists, the plan does
        // not. Leave both NULL so the user picks the current ones.
        service.importExport(users(userDoc("uid-1", "a@example.test", "Proceso de Admisión", "PX-Old")), false);

        var u = onlyUser();
        assertThat(u.getCareer()).isNull();
        assertThat(u.getPlan()).isNull();
    }

    @Test
    void appAbbreviatedCareerLabelIsNotGuessed() {
        service.importExport(users(userDoc("uid-1", "a@example.test", "Ing. Informática", "S10-Rev23")), false);
        assertThat(onlyUser().getCareer()).isNull();
        assertThat(onlyUser().getPlan()).isNull();
    }

    @Test
    void existingUserKeepsItsValuesAndOnlyFillsNulls() {
        var existing = new User(UUID.randomUUID(), "a@example.test", "Nombre Nuevo");
        existing.setCareer(careerPai);
        existing.setInstagram("ya.cargado");
        userRows.put(existing.getId(), existing);

        var report = service.importExport(users(new FirestoreUserDoc("uid-1", "A@EXAMPLE.TEST", "Nombre Viejo",
            "S", "S10-Rev23", false, new SocialMedia(null, "otro", "nuevo_discord"))), false);

        assertThat(report.getUpdated()).isEqualTo(1);
        assertThat(existing.getFirebaseUid()).isEqualTo("uid-1");
        assertThat(existing.getName()).isEqualTo("Nombre Nuevo");
        assertThat(existing.getCareer()).isSameAs(careerPai);
        assertThat(existing.getPlan()).isNull(); // S10-Rev23 is not a PAI plan
        assertThat(existing.getInstagram()).isEqualTo("ya.cargado");
        assertThat(existing.getDiscord()).isEqualTo("nuevo_discord");
        verify(followRows, never()).save(any(UserFollow.class));
    }

    @Test
    void moderatorFlagCreatesGrant() {
        var doc = new FirestoreUserDoc("uid-1", "mod@example.test", "Mod", null, null, true, null);

        service.importExport(users(doc), false);

        var u = onlyUser();
        var grant = moderatorRows.get(u.getId());
        assertThat(grant).isNotNull();
        assertThat(grant.isActive()).isTrue();
        assertThat(grant.getGrantedBy()).isNull();
        assertThat(grant.getGrantedAt()).isEqualTo(OffsetDateTime.parse("2026-03-01T12:00:00Z"));
    }

    @Test
    void moderatorGrantOnExistingUserCountsAsUpdate() {
        var existing = new User(UUID.randomUUID(), "mod@example.test", "Mod");
        existing.setFirebaseUid("uid-1");
        userRows.put(existing.getId(), existing);

        var report = service.importExport(users(
            new FirestoreUserDoc("uid-1", "mod@example.test", "Mod", null, null, true, null)), false);

        assertThat(report.getUpdated()).isEqualTo(1);
        assertThat(moderatorRows).containsKey(existing.getId());
    }

    @Test
    void revokedModeratorIsNotRegranted() {
        var existing = new User(UUID.randomUUID(), "mod@example.test", "Mod");
        existing.setFirebaseUid("uid-1");
        userRows.put(existing.getId(), existing);
        var revoked = new CeitbaModerator(existing.getId(), null, OffsetDateTime.parse("2025-01-01T00:00:00Z"));
        revoked.revoke(null, OffsetDateTime.parse("2025-06-01T00:00:00Z"));
        moderatorRows.put(existing.getId(), revoked);

        var report = service.importExport(users(
            new FirestoreUserDoc("uid-1", "mod@example.test", "Mod", null, null, true, null)), false);

        assertThat(revoked.isActive()).isFalse();
        assertThat(report.getSkipped()).isEqualTo(1);
        assertThat(report.getWarnings()).singleElement()
            .satisfies(w -> assertThat(w.message()).contains("revoked"));
    }

    @Test
    void invalidHandleIsDroppedWithWarning() {
        var doc = new FirestoreUserDoc("uid-1", "a@example.test", "A", null, null, false,
            new SocialMedia("https://example.test/not-linkedin", "ok_handle", null));

        var report = service.importExport(users(doc), false);

        var u = onlyUser();
        assertThat(u.getLinkedin()).isNull();
        assertThat(u.getInstagram()).isEqualTo("ok_handle");
        assertThat(report.getWarnings()).singleElement().satisfies(w -> {
            assertThat(w.collection()).isEqualTo("usuarios");
            assertThat(w.id()).isEqualTo("uid-1");
            assertThat(w.message()).isEqualTo("invalid linkedin handle dropped");
        });
    }

    @Test
    void badDocumentsAreReportedWithoutEmailsAndOthersStillImport() {
        var report = service.importExport(users(
            userDoc("uid-1", null, null, null),
            userDoc("uid-2", "not-an-email", null, null),
            userDoc(null, "x@example.test", null, null),
            userDoc("uid-4", "ok@example.test", null, null)), false);

        assertThat(report.getCreated()).isEqualTo(1);
        assertThat(report.getUsuarios().getErrors()).isEqualTo(3);
        assertThat(report.getErrors()).hasSize(3)
            .allSatisfy(e -> assertThat(e.message()).doesNotContain("@"));
        assertThat(report.getErrors()).extracting(FirestoreImportReport.Issue::id)
            .containsExactly("uid-1", "uid-2", null);
    }

    @Test
    void uidAndEmailOnDifferentUsersIsAnError() {
        var a = new User(UUID.randomUUID(), "a@example.test", "A");
        a.setFirebaseUid("uid-a");
        var b = new User(UUID.randomUUID(), "b@example.test", "B");
        userRows.put(a.getId(), a);
        userRows.put(b.getId(), b);

        var report = service.importExport(users(userDoc("uid-a", "b@example.test", null, null)), false);

        assertThat(report.getErrors()).singleElement()
            .satisfies(e -> assertThat(e.message()).isEqualTo("firebase uid and email belong to different users"));
        assertThat(b.getFirebaseUid()).isNull();
    }

    @Test
    void emailAlreadyLinkedToAnotherUidIsAnError() {
        var a = new User(UUID.randomUUID(), "a@example.test", "A");
        a.setFirebaseUid("uid-old");
        userRows.put(a.getId(), a);

        var report = service.importExport(users(userDoc("uid-new", "a@example.test", null, null)), false);

        assertThat(report.getUsuarios().getErrors()).isEqualTo(1);
        assertThat(a.getFirebaseUid()).isEqualTo("uid-old");
    }

    @Test
    void constraintViolationIsReportedGenerically() {
        doThrow(new DataIntegrityViolationException("Key (email)=(a@example.test) already exists"))
            .when(users).flush();

        var report = service.importExport(users(userDoc("uid-1", "a@example.test", null, null)), false);

        assertThat(report.getErrors()).singleElement()
            .satisfies(e -> assertThat(e.message()).isEqualTo("conflicts with an existing row"));
    }

    @Test
    void unexpectedExceptionIsReportedByTypeOnly() {
        when(users.findByFirebaseUid(anyString())).thenThrow(new IllegalStateException("boom a@example.test"));

        var report = service.importExport(users(userDoc("uid-1", "a@example.test", null, null)), false);

        assertThat(report.getErrors()).singleElement()
            .satisfies(e -> assertThat(e.message()).isEqualTo("unexpected error (IllegalStateException)"));
    }

    @Test
    void dryRunMarksEveryDocumentTransactionRollbackOnly() {
        var report = service.importExport(new FirestoreExport(
            List.of(userDoc("uid-1", "a@example.test", "S", "S10-Rev23")),
            null,
            List.of(benefit("Gimnasio", "deportes", List.of("10% off")))), true);

        assertThat(report.isDryRun()).isTrue();
        assertThat(report.getCreated()).isEqualTo(2);
        // One read-only catalogue transaction plus one per document.
        assertThat(statuses).hasSize(3);
        assertThat(statuses.subList(1, 3)).allSatisfy(s -> assertThat(s.isRollbackOnly()).isTrue());
    }

    @Test
    void nullDocumentsAndMissingCollectionsAreIgnored() {
        var withNull = new ArrayList<FirestoreUserDoc>();
        withNull.add(null);
        var report = service.importExport(new FirestoreExport(withNull, null, null), false);
        assertThat(report.getCreated() + report.getUpdated() + report.getSkipped()).isZero();
        assertThat(report.getErrors()).isEmpty();
    }

    // ------------------------------------------------------------- benefits

    @Test
    void benefitIsMappedToCard() {
        var report = service.importExport(benefits(
            benefit("Gimnasio", "Deportes", List.of(" 10% off ", "", "Pase libre"))), false);

        assertThat(report.getBenefits().getCreated()).isEqualTo(1);
        assertThat(cardRows).singleElement().satisfies(c -> {
            assertThat(c.getTitleEs()).isEqualTo("Gimnasio");
            assertThat(c.getTitleEn()).isEqualTo("Gimnasio");
            assertThat(c.getCategorySlug()).isEqualTo("deportes");
            assertThat(c.getBulletsEs()).containsExactly("10% off", "Pase libre");
            assertThat(c.getCtaUrl()).isEqualTo("https://forms.example.test/x");
            assertThat(c.getImageUrl()).isEqualTo("https://img.example.test/a.png");
            assertThat(c.getLocation()).isEqualTo("Av. Siempreviva 742");
            assertThat(c.getLocationUrl()).isEqualTo("https://maps.example.test/x");
            assertThat(c.getPhone()).isEqualTo("+54 11 0000-0000");
            assertThat(c.getWebsite()).isEqualTo("https://partner.example.test");
            assertThat(c.getEmail()).isEqualTo("contacto@partner.example.test");
        });
    }

    @Test
    void unknownOrMissingCategoryFallsBackToConvenios() {
        var report = service.importExport(benefits(
            benefit("Pizzeria", "comida", List.of("2x1")),
            benefit("Otro", null, List.of("x"))), false);

        assertThat(cardRows).extracting(BenefitCard::getCategorySlug).containsOnly("convenios");
        assertThat(report.getWarnings()).singleElement()
            .satisfies(w -> assertThat(w.message()).isEqualTo("unknown category 'comida' filed under convenios"));
    }

    @Test
    void benefitRerunUpdatesInPlaceWithoutDuplicates() {
        service.importExport(benefits(benefit("Gimnasio", "deportes", List.of("10% off"))), false);
        var card = cardRows.get(0);
        card.setTitleEn("Gym"); // translated by staff after the first run

        var same = service.importExport(benefits(benefit("gimnasio", "deportes", List.of("10% off"))), false);
        var changed = service.importExport(benefits(benefit("Gimnasio", "deportes", List.of("20% off"))), false);

        assertThat(cardRows).hasSize(1);
        assertThat(same.getBenefits().getUpdated()).isEqualTo(1); // title case differs
        assertThat(changed.getBenefits().getUpdated()).isEqualTo(1);
        assertThat(card.getBulletsEs()).containsExactly("20% off");
        assertThat(card.getTitleEs()).isEqualTo("Gimnasio");
        assertThat(card.getTitleEn()).isEqualTo("Gym");

        var again = service.importExport(benefits(benefit("Gimnasio", "deportes", List.of("20% off"))), false);
        assertThat(again.getBenefits().getSkipped()).isEqualTo(1);
    }

    @Test
    void nonHttpUrlsAndOversizedFieldsAreDropped() {
        var doc = new FirestoreBenefitDoc("b1", "Curso", "idiomas", null, "javascript:alert(1)",
            null, null, "intent://x", "www.no-scheme.test", "1".repeat(65), "https://ok.example.test", null);

        var report = service.importExport(benefits(doc), false);

        var c = cardRows.get(0);
        assertThat(c.getImageUrl()).isNull();
        assertThat(c.getLocationUrl()).isNull();
        assertThat(c.getCtaUrl()).isNull();
        assertThat(c.getPhone()).isNull();
        assertThat(c.getWebsite()).isEqualTo("https://ok.example.test");
        assertThat(c.getBulletsEs()).isEmpty();
        assertThat(report.getWarnings()).hasSize(4);
    }

    @Test
    void benefitWithoutTitleOrWithAmbiguousTitleIsAnError() {
        cardRows.add(new BenefitCard("convenios", "Duplicado", "Duplicado"));
        cardRows.add(new BenefitCard("convenios", "duplicado", "duplicado"));

        var report = service.importExport(benefits(
            benefit("Duplicado", "convenios", List.of()),
            new FirestoreBenefitDoc("b2", " ", null, null, null, null, null, null, null, null, null, null)), false);

        assertThat(report.getBenefits().getErrors()).isEqualTo(2);
        assertThat(report.getErrors()).extracting(FirestoreImportReport.Issue::message)
            .containsExactly("several benefit cards share this title", "missing title");
    }

    // ------------------------------------------------------------ proposals

    @Test
    void proposalsAreSkippedWhileImporterIsUnavailable() {
        when(proposals.isAvailable()).thenReturn(false);

        var report = service.importExport(new FirestoreExport(null,
            List.of(Map.of("id", "p1"), Map.of("id", "p2")), null), false);

        assertThat(report.getPropuestas().getSkipped()).isEqualTo(2);
        assertThat(report.getWarnings()).singleElement()
            .satisfies(w -> assertThat(w.collection()).isEqualTo("propuestas"));
        verify(proposals, never()).importProposal(any(), any(), any());
    }

    @Test
    void proposalsGoThroughTheImporterWhenAvailable() {
        when(proposals.isAvailable()).thenReturn(true);
        when(proposals.importProposal(eq("p1"), any(), any())).thenReturn(Outcome.CREATED);
        when(proposals.importProposal(eq("p2"), any(), any())).thenThrow(new FirestoreImportException("unknown author"));

        var report = service.importExport(new FirestoreExport(null,
            List.of(Map.of("id", "p1"), Map.of("id", "p2"), Map.of("title", "no id")), null), false);

        assertThat(report.getPropuestas().getCreated()).isEqualTo(1);
        assertThat(report.getPropuestas().getErrors()).isEqualTo(2);
        assertThat(report.getErrors()).extracting(FirestoreImportReport.Issue::message)
            .containsExactly("unknown author", "missing document id");
    }

    @Test
    void importerWarningsAreReportedUnderTheDocument() {
        when(proposals.isAvailable()).thenReturn(true);
        when(proposals.importProposal(eq("p1"), any(), any())).thenAnswer(inv -> {
            List<String> warnings = inv.getArgument(2);
            warnings.add("2 votes by users not imported dropped");
            return Outcome.UPDATED;
        });

        var report = service.importExport(new FirestoreExport(null, List.of(Map.of("id", "p1")), null), false);

        assertThat(report.getPropuestas().getUpdated()).isEqualTo(1);
        assertThat(report.getWarnings()).singleElement().satisfies(w -> {
            assertThat(w.collection()).isEqualTo("propuestas");
            assertThat(w.id()).isEqualTo("p1");
            assertThat(w.message()).isEqualTo("2 votes by users not imported dropped");
        });
    }
}
