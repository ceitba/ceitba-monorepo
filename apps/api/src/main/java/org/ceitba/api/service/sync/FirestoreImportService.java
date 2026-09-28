package org.ceitba.api.service.sync;

import org.ceitba.api.common.exception.ValidationException;
import org.ceitba.api.domain.BenefitCard;
import org.ceitba.api.domain.CeitbaModerator;
import org.ceitba.api.domain.User;
import org.ceitba.api.repository.BenefitCardRepository;
import org.ceitba.api.repository.BenefitRepository;
import org.ceitba.api.repository.CareerRepository;
import org.ceitba.api.repository.CeitbaModeratorRepository;
import org.ceitba.api.repository.PlanRepository;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.service.news.FollowService;
import org.ceitba.api.service.sync.FirestoreImportReport.Outcome;
import org.ceitba.api.service.user.SocialHandles;
import org.ceitba.api.web.sync.dto.FirestoreBenefitDoc;
import org.ceitba.api.web.sync.dto.FirestoreExport;
import org.ceitba.api.web.sync.dto.FirestoreUserDoc;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.function.Consumer;
import java.util.function.Function;
import java.util.function.UnaryOperator;
import java.util.regex.Pattern;

// One-time import of the legacy Firestore project (see FirestoreExport and
// scripts/firestore-export). Idempotent: re-running with the same export
// updates rows in place and never duplicates them.
//
// Every document runs in its own transaction, so a bad document is reported
// and skipped without rolling back the others. On a dry run each of those
// transactions is flushed (so constraint violations still surface) and then
// rolled back: the report is what a real run would do, and nothing changes.
// (A dry run cannot see its own earlier documents, so two documents for the
// same email would both report CREATED.)
//
// Usuarios -> public.user
//   * A uid in deleted_firebase_accounts (the account was deleted through
//     DELETE /v1/me) is SKIPPED with a warning, never re-created or linked.
//   * Matched by firebase_uid, else by email (case-insensitive); created with
//     the lowercased email when neither matches.
//   * Only fills columns that are still NULL: whatever the user or staff set
//     in the new system wins over the old app's data.
//   * degree -> career only on an exact career id, or a career name equal
//     ignoring case. plan -> only a plan of that career. When the document
//     names a plan that is not one of the matched career's plans, the career
//     is dropped too: that is stale data (typically a past year's entrance
//     program, whose codes change yearly), and leaving both NULL lets the
//     user pick their current career and plan in app onboarding. No
//     entrance-program code or name is hardcoded here.
//   * socialMedia goes through SocialHandles; an invalid handle is dropped
//     with a warning.
//   * moderator: true -> an active ceitba_moderators row (granted_by NULL).
//     A grant that staff revoked is not re-granted.
//   * fileNo is not imported: the user enters their file number once via
//     PATCH /v1/me/profile (staff can correct it).
// Benefits -> public.benefit_cards, matched by Spanish title (ignoring case).
// Propuestas -> FirestoreProposalImporter (ProposalFirestoreImporter documents
//   the mapping). Imported after Usuarios so authors resolve by firebase_uid.
//   A dry run cannot see the users it would create, so on a first dry run
//   proposals by not-yet-imported users report their authors as missing.
//
// Reports and logs carry Firestore document ids only, never emails.
@Service
public class FirestoreImportService {

    private static final Logger log = LoggerFactory.getLogger(FirestoreImportService.class);

    static final String USUARIOS = "usuarios";
    static final String BENEFITS = "benefits";
    static final String PROPUESTAS = "propuestas";
    static final String FALLBACK_CATEGORY = "convenios";
    static final String CEITBA_ORG = "ceitba";

    // Same rule the staff benefit-card endpoints enforce on links.
    private static final Pattern HTTP_URL = Pattern.compile("^https?://\\S+$");
    private static final int MAX_URL = 2048;
    private static final int MAX_VARCHAR = 255;
    private static final int MAX_PHONE = 64;

    private final UserRepository users;
    private final CareerRepository careers;
    private final PlanRepository plans;
    private final CeitbaModeratorRepository moderators;
    private final BenefitRepository categories;
    private final BenefitCardRepository cards;
    private final FollowService follows;
    private final FirestoreProposalImporter proposals;
    private final TransactionTemplate perDocumentTx;
    private final TransactionTemplate readOnlyTx;
    private final Clock clock;

    public FirestoreImportService(UserRepository users,
                                  CareerRepository careers,
                                  PlanRepository plans,
                                  CeitbaModeratorRepository moderators,
                                  BenefitRepository categories,
                                  BenefitCardRepository cards,
                                  FollowService follows,
                                  FirestoreProposalImporter proposals,
                                  PlatformTransactionManager txManager,
                                  Clock clock) {
        this.users = users;
        this.careers = careers;
        this.plans = plans;
        this.moderators = moderators;
        this.categories = categories;
        this.cards = cards;
        this.follows = follows;
        this.proposals = proposals;
        this.perDocumentTx = new TransactionTemplate(txManager);
        this.perDocumentTx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.readOnlyTx = new TransactionTemplate(txManager);
        this.readOnlyTx.setReadOnly(true);
        this.clock = clock;
    }

    public FirestoreImportReport importExport(FirestoreExport export, boolean dryRun) {
        var report = new FirestoreImportReport(dryRun);
        var catalogue = readOnlyTx.execute(status -> loadCatalogue());

        for (var doc : export.usuariosOrEmpty()) {
            if (doc == null) continue;
            runDocument(report, USUARIOS, doc.id(), report.getUsuarios(), dryRun,
                warnings -> importUser(doc, catalogue, warnings));
        }
        for (var doc : export.benefitsOrEmpty()) {
            if (doc == null) continue;
            runDocument(report, BENEFITS, doc.id(), report.getBenefits(), dryRun,
                warnings -> importBenefit(doc, warnings));
        }
        importProposals(export.propuestasOrEmpty(), report, dryRun);

        log.info("Firestore import (dryRun={}): created={} updated={} skipped={} errors={} warnings={}",
            dryRun, report.getCreated(), report.getUpdated(), report.getSkipped(),
            report.getErrors().size(), report.getWarnings().size());
        return report;
    }

    private void importProposals(List<Map<String, Object>> docs, FirestoreImportReport report, boolean dryRun) {
        if (docs.isEmpty()) return;
        if (!proposals.isAvailable()) {
            report.getPropuestas().skipped += docs.size();
            report.warning(PROPUESTAS, null,
                docs.size() + " documents skipped: the proposal schema is not available yet");
            return;
        }
        for (var doc : docs) {
            if (doc == null) continue;
            var id = doc.get("id") instanceof String s ? s : null;
            runDocument(report, PROPUESTAS, id, report.getPropuestas(), dryRun,
                warnings -> {
                    if (id == null || id.isBlank()) throw new FirestoreImportException("missing document id");
                    return proposals.importProposal(id, doc, warnings);
                });
        }
    }

    private void runDocument(FirestoreImportReport report, String collection, String id,
                             FirestoreImportReport.Counters counters, boolean dryRun,
                             Function<List<String>, Outcome> work) {
        var warnings = new ArrayList<String>();
        try {
            Outcome outcome = perDocumentTx.execute(status -> {
                var result = work.apply(warnings);
                users.flush(); // surface constraint violations inside the try, also on dry runs
                if (dryRun) status.setRollbackOnly();
                return result;
            });
            counters.count(outcome);
            warnings.forEach(w -> report.warning(collection, id, w));
        } catch (FirestoreImportException e) {
            counters.errors++;
            report.error(collection, id, e.getMessage());
        } catch (DataIntegrityViolationException e) {
            // The driver message quotes the conflicting values (emails), so
            // it is neither reported nor logged.
            counters.errors++;
            report.error(collection, id, "conflicts with an existing row");
            log.warn("Firestore import {}/{}: constraint violation", collection, id);
        } catch (RuntimeException e) {
            counters.errors++;
            report.error(collection, id, "unexpected error (" + e.getClass().getSimpleName() + ")");
            log.warn("Firestore import {}/{} failed: {}", collection, id, e.getClass().getName());
        }
    }

    // ---------------------------------------------------------------- users

    private Outcome importUser(FirestoreUserDoc doc, Catalogue catalogue, List<String> warnings) {
        String uid = trimToNull(doc.id());
        if (uid == null) throw new FirestoreImportException("missing document id");
        if (uid.length() > 128) throw new FirestoreImportException("document id longer than 128 characters");
        if (users.isDeletedFirebaseAccount(uid)) {
            warnings.add("account was deleted in the new app; not re-imported");
            return Outcome.SKIPPED;
        }
        String email = trimToNull(doc.email());
        if (email == null || email.indexOf('@') < 1 || email.length() > MAX_VARCHAR) {
            throw new FirestoreImportException("missing or invalid email");
        }
        email = email.toLowerCase(Locale.ROOT);

        var byUid = users.findByFirebaseUid(uid);
        var byEmail = users.findFirstByEmailIgnoreCaseOrderByCreatedAtAsc(email);
        if (byUid.isPresent() && byEmail.isPresent() && !byUid.get().getId().equals(byEmail.get().getId())) {
            throw new FirestoreImportException("firebase uid and email belong to different users");
        }

        User user;
        boolean created = false;
        boolean changed = false;
        if (byUid.isPresent()) {
            user = byUid.get();
        } else if (byEmail.isPresent()) {
            user = byEmail.get();
            if (user.getFirebaseUid() != null) {
                throw new FirestoreImportException("user is already linked to another firebase uid");
            }
        } else {
            user = new User(UUID.randomUUID(), email, null);
            created = true;
        }

        if (user.getFirebaseUid() == null) {
            user.setFirebaseUid(uid);
            changed = true;
        }
        String name = trimToNull(doc.name());
        if (user.getName() == null && name != null) {
            user.setName(name);
            changed = true;
        }

        var academic = catalogue.resolve(doc.degree(), doc.plan());
        if (user.getCareer() == null && academic.careerId() != null) {
            user.setCareer(careers.getReferenceById(academic.careerId()));
            changed = true;
        }
        if (user.getPlan() == null && academic.planId() != null
            && user.getCareer() != null && academic.careerId().equals(user.getCareer().getId())) {
            user.setPlan(academic.planId());
            changed = true;
        }

        var social = doc.socialMedia();
        if (social != null) {
            changed |= fillHandle(user.getLinkedin(), social.linkedin(), SocialHandles::linkedin,
                user::setLinkedin, "linkedin", warnings);
            changed |= fillHandle(user.getInstagram(), social.instagram(), SocialHandles::instagram,
                user::setInstagram, "instagram", warnings);
            changed |= fillHandle(user.getDiscord(), social.discord(), SocialHandles::discord,
                user::setDiscord, "discord", warnings);
        }

        if (created) {
            user = users.save(user);
            follows.followIfMissing(user.getId(), CEITBA_ORG);
        } else if (changed) {
            user = users.save(user);
        }

        if (Boolean.TRUE.equals(doc.moderator())) {
            var grant = moderators.findById(user.getId());
            if (grant.isEmpty()) {
                moderators.save(new CeitbaModerator(user.getId(), null, OffsetDateTime.now(clock)));
                changed = true;
            } else if (!grant.get().isActive()) {
                warnings.add("moderator grant was revoked by staff; not re-granted");
            }
        }

        if (created) return Outcome.CREATED;
        return changed ? Outcome.UPDATED : Outcome.SKIPPED;
    }

    private static boolean fillHandle(String current, String raw, UnaryOperator<String> normalizer,
                                      Consumer<String> setter, String field, List<String> warnings) {
        if (current != null || raw == null || raw.isBlank()) return false;
        try {
            setter.accept(normalizer.apply(raw));
            return true;
        } catch (ValidationException e) {
            warnings.add("invalid " + field + " handle dropped");
            return false;
        }
    }

    // ------------------------------------------------------------- benefits

    private Outcome importBenefit(FirestoreBenefitDoc doc, List<String> warnings) {
        String title = trimToNull(doc.title());
        if (title == null) throw new FirestoreImportException("missing title");
        if (title.length() > MAX_VARCHAR) throw new FirestoreImportException("title longer than 255 characters");

        var matches = cards.findByTitleEsIgnoreCase(title);
        if (matches.size() > 1) throw new FirestoreImportException("several benefit cards share this title");

        String slug = categorySlug(doc.category(), warnings);
        boolean created = matches.isEmpty();
        var card = created ? new BenefitCard(slug, title, title) : matches.get(0);

        boolean changed = false;
        changed |= apply(card.getCategorySlug(), slug, card::setCategorySlug);
        changed |= apply(card.getTitleEs(), title, card::setTitleEs);
        changed |= apply(card.getBulletsEs(), bullets(doc.description()), card::setBulletsEs);
        changed |= apply(card.getImageUrl(), url(doc.imageUrl(), "imageUrl", warnings), card::setImageUrl);
        changed |= apply(card.getCtaUrl(), url(doc.inscriptionUrl(), "inscriptionUrl", warnings), card::setCtaUrl);
        changed |= apply(card.getLocation(), trimToNull(doc.location()), card::setLocation);
        changed |= apply(card.getLocationUrl(), url(doc.locationUrl(), "locationUrl", warnings), card::setLocationUrl);
        changed |= apply(card.getPhone(), bounded(doc.phone(), MAX_PHONE, "phone", warnings), card::setPhone);
        changed |= apply(card.getWebsite(), url(doc.website(), "website", warnings), card::setWebsite);
        changed |= apply(card.getEmail(), bounded(doc.email(), MAX_VARCHAR, "email", warnings), card::setEmail);

        if (created || changed) cards.save(card);
        if (created) return Outcome.CREATED;
        return changed ? Outcome.UPDATED : Outcome.SKIPPED;
    }

    private String categorySlug(String category, List<String> warnings) {
        String slug = trimToNull(category);
        if (slug != null) {
            slug = slug.toLowerCase(Locale.ROOT);
            if (categories.existsById(slug)) return slug;
        }
        if (!categories.existsById(FALLBACK_CATEGORY)) {
            throw new FirestoreImportException("fallback category '" + FALLBACK_CATEGORY + "' does not exist");
        }
        if (slug != null) warnings.add("unknown category '" + slug + "' filed under " + FALLBACK_CATEGORY);
        return FALLBACK_CATEGORY;
    }

    private static List<String> bullets(List<String> description) {
        if (description == null) return new ArrayList<>();
        var out = new ArrayList<String>();
        for (var line : description) {
            String t = trimToNull(line);
            if (t != null) out.add(t);
        }
        return out;
    }

    private static String url(String raw, String field, List<String> warnings) {
        String v = trimToNull(raw);
        if (v == null) return null;
        if (v.length() > MAX_URL || !HTTP_URL.matcher(v).matches()) {
            warnings.add(field + " is not an http(s) URL; dropped");
            return null;
        }
        return v;
    }

    private static String bounded(String raw, int max, String field, List<String> warnings) {
        String v = trimToNull(raw);
        if (v != null && v.length() > max) {
            warnings.add(field + " longer than " + max + " characters; dropped");
            return null;
        }
        return v;
    }

    private static <T> boolean apply(T current, T next, Consumer<T> setter) {
        if (Objects.equals(current, next)) return false;
        setter.accept(next);
        return true;
    }

    private static String trimToNull(String s) {
        if (s == null) return null;
        String t = s.trim();
        return t.isEmpty() ? null : t;
    }

    // ------------------------------------------------------------ catalogue

    private Catalogue loadCatalogue() {
        var ids = new HashSet<String>();
        var idsByName = new HashMap<String, String>();
        for (var career : careers.findAll()) {
            ids.add(career.getId());
            if (career.getName() != null) {
                idsByName.putIfAbsent(career.getName().trim().toLowerCase(Locale.ROOT), career.getId());
            }
        }
        var plansByCareer = new HashMap<String, Set<String>>();
        for (var plan : plans.findAll()) {
            plansByCareer.computeIfAbsent(plan.getCareer().getId(), k -> new HashSet<>()).add(plan.getId());
        }
        return new Catalogue(Set.copyOf(ids), Map.copyOf(idsByName), Map.copyOf(plansByCareer));
    }

    record AcademicMatch(String careerId, String planId) {
        static final AcademicMatch NONE = new AcademicMatch(null, null);
    }

    // Careers and plans as of the start of the run (the import never writes them).
    record Catalogue(Set<String> careerIds, Map<String, String> careerIdsByName,
                     Map<String, Set<String>> planIdsByCareer) {

        AcademicMatch resolve(String degree, String plan) {
            String d = trimToNull(degree);
            if (d == null) return AcademicMatch.NONE;
            String careerId = careerIds.contains(d) ? d : careerIdsByName.get(d.toLowerCase(Locale.ROOT));
            if (careerId == null) return AcademicMatch.NONE;
            String p = trimToNull(plan);
            if (p == null) return new AcademicMatch(careerId, null);
            if (planIdsByCareer.getOrDefault(careerId, Set.of()).contains(p)) {
                return new AcademicMatch(careerId, p);
            }
            // A plan outside the career's catalogue: stale, let the user pick both.
            return AcademicMatch.NONE;
        }
    }
}
