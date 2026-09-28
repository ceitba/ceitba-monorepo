package org.ceitba.api.service.proposal;

import org.ceitba.api.common.exception.InvalidStateException;
import org.ceitba.api.common.exception.RateLimitExceededException;
import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.common.exception.ValidationException;
import org.ceitba.api.domain.ProposalStatus;
import org.ceitba.api.domain.proposal.Proposal;
import org.ceitba.api.domain.proposal.ProposalAlias;
import org.ceitba.api.domain.proposal.ProposalAliasId;
import org.ceitba.api.domain.proposal.ProposalComment;
import org.ceitba.api.domain.proposal.ProposalLifecycle;
import org.ceitba.api.domain.proposal.ProposalTopic;
import org.ceitba.api.domain.proposal.ProposalVote;
import org.ceitba.api.domain.proposal.ProposalVoteId;
import org.ceitba.api.domain.proposal.ProposalVoteValue;
import org.ceitba.api.repository.proposal.ProposalAliasRepository;
import org.ceitba.api.repository.proposal.ProposalAttachmentRepository;
import org.ceitba.api.repository.proposal.ProposalCommentRepository;
import org.ceitba.api.repository.proposal.ProposalRepository;
import org.ceitba.api.repository.proposal.ProposalVoteRepository;
import org.ceitba.api.config.RateLimitProperties;
import org.ceitba.api.service.crypto.ContentHmac;
import org.ceitba.api.service.media.MediaUploadService;
import org.ceitba.api.service.media.ObjectStorage;
import org.ceitba.api.service.media.PresignedUpload;
import org.ceitba.api.service.ratelimit.UserRateLimiter;
import org.ceitba.api.web.media.dto.SignUploadRequest;
import org.ceitba.api.web.proposal.dto.CreateProposalCommentRequest;
import org.ceitba.api.web.proposal.dto.CreateProposalRequest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Random;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

// Unit tests with in-memory stand-ins for the vote and alias tables, so
// counter arithmetic and alias stability are checked without a database.
class ProposalServiceTest {

    private static final UUID AUTHOR = UUID.randomUUID();
    private static final UUID ALICE = UUID.randomUUID();
    private static final UUID BOB = UUID.randomUUID();
    private static final UUID MOD = UUID.randomUUID();
    private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-03-01T12:00:00Z"), ZoneOffset.UTC);

    private final ProposalRepository proposals = mock(ProposalRepository.class);
    private final ProposalAttachmentRepository attachments = mock(ProposalAttachmentRepository.class);
    private final ProposalVoteRepository votes = mock(ProposalVoteRepository.class);
    private final ProposalCommentRepository comments = mock(ProposalCommentRepository.class);
    private final ProposalAliasRepository aliases = mock(ProposalAliasRepository.class);
    // Real service over a stub store: mocking concrete classes is not
    // portable across JDKs, and real keys exercise the ownership check.
    private final MediaUploadService media = new MediaUploadService(new ObjectStorage() {
        @Override public PresignedUpload presignPut(String key, String type, long len) {
            return new PresignedUpload("https://bucket.test/" + key, Map.of(), Instant.EPOCH);
        }
        @Override public String publicUrl(String key) { return "https://media.test/" + key; }
    }, new UserRateLimiter(new RateLimitProperties(false, false, null, null, null)),
        ContentHmac.fromJwtSecret("dGVzdC1qd3Qtc2VjcmV0LWtleS0zMmJ5dGVzLWxvbmch"));
    private final ApplicationEventPublisher events = mock(ApplicationEventPublisher.class);

    private final Map<ProposalVoteId, ProposalVote> voteRows = new HashMap<>();
    private final Map<ProposalAliasId, ProposalAlias> aliasRows = new HashMap<>();

    private ProposalService service;
    private ProposalModerationService moderation;
    private ProposalAliasService aliasService;

    @BeforeEach
    void setUp() {
        when(votes.findById(any())).thenAnswer(i -> Optional.ofNullable(voteRows.get(i.<ProposalVoteId>getArgument(0))));
        when(votes.save(any())).thenAnswer(i -> {
            ProposalVote v = i.getArgument(0);
            voteRows.put(new ProposalVoteId(v.getProposalId(), v.getUserId()), v);
            return v;
        });
        org.mockito.Mockito.doAnswer(i -> {
            ProposalVote v = i.getArgument(0);
            voteRows.remove(new ProposalVoteId(v.getProposalId(), v.getUserId()));
            return null;
        }).when(votes).delete(any());

        when(aliases.findById(any())).thenAnswer(i -> Optional.ofNullable(aliasRows.get(i.<ProposalAliasId>getArgument(0))));
        when(aliases.findAliasesByProposalId(any())).thenAnswer(i -> {
            UUID pid = i.getArgument(0);
            var out = new HashSet<String>();
            aliasRows.values().stream().filter(a -> a.getProposalId().equals(pid)).forEach(a -> out.add(a.getAlias()));
            return out;
        });
        when(aliases.save(any())).thenAnswer(i -> {
            ProposalAlias a = i.getArgument(0);
            aliasRows.put(new ProposalAliasId(a.getProposalId(), a.getUserId()), a);
            return a;
        });

        when(comments.saveAndFlush(any())).thenAnswer(i -> withId(i.getArgument(0)));
        when(proposals.saveAndFlush(any())).thenAnswer(i -> withId(i.getArgument(0)));

        aliasService = new ProposalAliasService(aliases,
            new ProposalAliasGenerator(List.of("AlfaRojo", "BetaAzul", "GammaVerde"), new Random(7)));
        var views = new ProposalViews(attachments, votes, aliases, media);
        service = new ProposalService(proposals, attachments, votes, comments, aliases, aliasService, views, media,
            new UserRateLimiter(new RateLimitProperties(false, false, null, null, null)), CLOCK);
        moderation = new ProposalModerationService(proposals, comments, views, events, CLOCK);
    }

    private static <T> T withId(T entity) {
        if (ReflectionTestUtils.getField(entity, "id") == null) {
            ReflectionTestUtils.setField(entity, "id", UUID.randomUUID());
        }
        return entity;
    }

    private Proposal stored(ProposalStatus status) {
        Proposal p = withId(new Proposal(AUTHOR, "Microondas", "Más microondas", ProposalTopic.VIDA_UNIVERSITARIA));
        if (status != ProposalStatus.PENDING) p.moderate(status, null, MOD, null);
        when(proposals.findById(p.getId())).thenReturn(Optional.of(p));
        when(proposals.findForUpdate(p.getId())).thenReturn(Optional.of(p));
        return p;
    }

    // --- Votes -------------------------------------------------------------

    @Test
    void voteCastChangeRepeatAndRemoveKeepCountersConsistent() {
        Proposal p = stored(ProposalStatus.APPROVED);

        var r = service.vote(p.getId(), ALICE, ProposalVoteValue.UP);
        assertThat(r.upCount()).isEqualTo(1);
        assertThat(r.downCount()).isZero();
        assertThat(r.myVote()).isEqualTo(ProposalVoteValue.UP);

        service.vote(p.getId(), BOB, ProposalVoteValue.UP);
        assertThat(p.getUpCount()).isEqualTo(2);

        // Changing the vote moves it between counters.
        r = service.vote(p.getId(), ALICE, ProposalVoteValue.DOWN);
        assertThat(r.upCount()).isEqualTo(1);
        assertThat(r.downCount()).isEqualTo(1);

        // Same vote again is a no-op.
        r = service.vote(p.getId(), ALICE, ProposalVoteValue.DOWN);
        assertThat(r.upCount()).isEqualTo(1);
        assertThat(r.downCount()).isEqualTo(1);

        r = service.removeVote(p.getId(), ALICE);
        assertThat(r.upCount()).isEqualTo(1);
        assertThat(r.downCount()).isZero();
        assertThat(r.myVote()).isNull();

        // Removing again is idempotent.
        r = service.removeVote(p.getId(), ALICE);
        assertThat(r.upCount()).isEqualTo(1);
        assertThat(voteRows).hasSize(1);
    }

    @Test
    void votingNeedsAnApprovedOpenProposal() {
        Proposal pending = stored(ProposalStatus.PENDING);
        // Someone else's pending proposal does not exist for them.
        assertThatThrownBy(() -> service.vote(pending.getId(), ALICE, ProposalVoteValue.UP))
            .isInstanceOf(ResourceNotFoundException.class);
        // The author sees it but cannot vote yet.
        assertThatThrownBy(() -> service.vote(pending.getId(), AUTHOR, ProposalVoteValue.UP))
            .isInstanceOf(InvalidStateException.class);

        Proposal closed = stored(ProposalStatus.APPROVED);
        closed.setLifecycle(ProposalLifecycle.CERRADO);
        assertThatThrownBy(() -> service.vote(closed.getId(), ALICE, ProposalVoteValue.UP))
            .isInstanceOf(InvalidStateException.class);
        assertThat(closed.getUpCount()).isZero();

        UUID missing = UUID.randomUUID();
        when(proposals.findForUpdate(missing)).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.vote(missing, ALICE, ProposalVoteValue.UP))
            .isInstanceOf(ResourceNotFoundException.class);
    }

    // --- Aliases and comments ---------------------------------------------

    @Test
    void aliasIsStablePerUserAndProposalAndUniqueWithinIt() {
        Proposal p = stored(ProposalStatus.APPROVED);
        Proposal other = stored(ProposalStatus.APPROVED);

        var a1 = service.addComment(p.getId(), ALICE, new CreateProposalCommentRequest("Hola", null));
        var a2 = service.addComment(p.getId(), ALICE, new CreateProposalCommentRequest("De nuevo", null));
        var b1 = service.addComment(p.getId(), BOB, new CreateProposalCommentRequest("Chau", null));

        assertThat(a1.alias()).isNotNull().isEqualTo(a2.alias());
        assertThat(b1.alias()).isNotNull().isNotEqualTo(a1.alias());
        assertThat(a1.isMine()).isTrue();
        assertThat(a1.isAuthor()).isFalse();
        assertThat(aliasService.aliasFor(p.getId(), ALICE)).isEqualTo(a1.alias());

        // Aliases are per proposal: the same user gets an independent one elsewhere.
        service.addComment(other.getId(), ALICE, new CreateProposalCommentRequest("Otro", null));
        assertThat(aliasRows).containsKey(new ProposalAliasId(other.getId(), ALICE));
        assertThat(aliasRows.values().stream().filter(a -> a.getProposalId().equals(p.getId())).count()).isEqualTo(2);

        assertThat(p.getCommentCount()).isEqualTo(3);
        assertThat(other.getCommentCount()).isEqualTo(1);
    }

    @Test
    void authorCommentIsFlaggedAsAuthor() {
        Proposal p = stored(ProposalStatus.APPROVED);
        var c = service.addComment(p.getId(), AUTHOR, new CreateProposalCommentRequest("Soy OP", null));
        assertThat(c.isAuthor()).isTrue();
        assertThat(c.isMine()).isTrue();
    }

    @Test
    void repliesAreOneLevelDeepOnTheSameProposal() {
        Proposal p = stored(ProposalStatus.APPROVED);
        var top = withId(new ProposalComment(p.getId(), BOB, null, "Top"));
        var reply = withId(new ProposalComment(p.getId(), BOB, top.getId(), "Reply"));
        when(comments.findByIdAndProposalId(top.getId(), p.getId())).thenReturn(Optional.of(top));
        when(comments.findByIdAndProposalId(reply.getId(), p.getId())).thenReturn(Optional.of(reply));

        var ok = service.addComment(p.getId(), ALICE, new CreateProposalCommentRequest("Respuesta", top.getId()));
        assertThat(ok.parentId()).isEqualTo(top.getId());

        assertThatThrownBy(() -> service.addComment(p.getId(), ALICE,
                new CreateProposalCommentRequest("Anidada", reply.getId())))
            .isInstanceOf(ValidationException.class);
        UUID elsewhere = UUID.randomUUID();
        when(comments.findByIdAndProposalId(elsewhere, p.getId())).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.addComment(p.getId(), ALICE,
                new CreateProposalCommentRequest("x", elsewhere)))
            .isInstanceOf(ValidationException.class);
        top.softDelete(java.time.OffsetDateTime.now(CLOCK));
        assertThatThrownBy(() -> service.addComment(p.getId(), ALICE,
                new CreateProposalCommentRequest("x", top.getId())))
            .isInstanceOf(ValidationException.class);
    }

    @Test
    void deletingOwnCommentDecrementsOnceAndOthersGet404() {
        Proposal p = stored(ProposalStatus.APPROVED);
        p.adjustComments(1);
        var mine = withId(new ProposalComment(p.getId(), ALICE, null, "Mío"));
        when(comments.findByIdAndProposalId(mine.getId(), p.getId())).thenReturn(Optional.of(mine));

        assertThatThrownBy(() -> service.deleteOwnComment(p.getId(), mine.getId(), BOB))
            .isInstanceOf(ResourceNotFoundException.class);

        service.deleteOwnComment(p.getId(), mine.getId(), ALICE);
        assertThat(mine.isDeleted()).isTrue();
        assertThat(mine.getBody()).isNull();
        assertThat(p.getCommentCount()).isZero();

        assertThatThrownBy(() -> service.deleteOwnComment(p.getId(), mine.getId(), ALICE))
            .isInstanceOf(ResourceNotFoundException.class);
        assertThat(p.getCommentCount()).isZero();
    }

    // --- Create and visibility --------------------------------------------

    @Test
    void createIsPendingWithAuthorAliasAndOnlyOwnAttachmentKeys() {
        String key = media.signProposalAttachment(AUTHOR, new SignUploadRequest("a.png", "image/png", 10)).key();
        String alicesKey = media.signProposalAttachment(ALICE, new SignUploadRequest("a.png", "image/png", 10)).key();

        var created = service.create(AUTHOR, new CreateProposalRequest(" Título ", "Desc", ProposalTopic.EVENTOS, List.of(key)));
        assertThat(created.status()).isEqualTo(ProposalStatus.PENDING);
        assertThat(created.lifecycle()).isEqualTo(ProposalLifecycle.ABIERTO);
        assertThat(created.title()).isEqualTo("Título");
        assertThat(created.isMine()).isTrue();
        var saved = org.mockito.ArgumentCaptor.forClass(org.ceitba.api.domain.proposal.ProposalAttachment.class);
        verify(attachments).save(saved.capture());
        assertThat(saved.getValue().getObjectKey()).isEqualTo(key);
        assertThat(saved.getValue().getContentType()).isEqualTo("image/png");
        assertThat(saved.getValue().getPosition()).isZero();
        assertThat(aliasRows).containsKey(new ProposalAliasId(created.id(), AUTHOR));

        assertThatThrownBy(() -> service.create(AUTHOR, new CreateProposalRequest("T", "D", ProposalTopic.OTROS,
                List.of(alicesKey))))
            .isInstanceOf(ValidationException.class);
        assertThatThrownBy(() -> service.create(AUTHOR, new CreateProposalRequest("T", "D", ProposalTopic.OTROS,
                List.of(key, key))))
            .isInstanceOf(ValidationException.class);
        when(attachments.existsByObjectKeyIn(anyCollection())).thenReturn(true);
        assertThatThrownBy(() -> service.create(AUTHOR, new CreateProposalRequest("T", "D", ProposalTopic.OTROS,
                List.of(key))))
            .isInstanceOf(ValidationException.class);
    }

    @Test
    void creatingAndCommentingAreRateLimitedPerUserAfterValidation() {
        var limiter = new UserRateLimiter(new RateLimitProperties(true, false, null, null, Map.of(
            ProposalService.CREATE_RATE_RULE, new RateLimitProperties.UserRule(1, Duration.ofHours(1)),
            ProposalService.COMMENT_RATE_RULE, new RateLimitProperties.UserRule(2, Duration.ofMinutes(10)))));
        var limited = new ProposalService(proposals, attachments, votes, comments, aliases, aliasService,
            new ProposalViews(attachments, votes, aliases, media), media, limiter, CLOCK);

        // An invalid create does not burn quota.
        assertThatThrownBy(() -> limited.create(ALICE, new CreateProposalRequest("T", "D", ProposalTopic.OTROS,
                List.of("proposals/not-a-key.png"))))
            .isInstanceOf(ValidationException.class);
        limited.create(ALICE, new CreateProposalRequest("T", "D", ProposalTopic.OTROS, List.of()));
        assertThatThrownBy(() -> limited.create(ALICE, new CreateProposalRequest("T", "D", ProposalTopic.OTROS, List.of())))
            .isInstanceOf(RateLimitExceededException.class);
        limited.create(BOB, new CreateProposalRequest("T", "D", ProposalTopic.OTROS, List.of()));

        Proposal p = stored(ProposalStatus.APPROVED);
        // Replying to a missing parent does not burn quota either.
        assertThatThrownBy(() -> limited.addComment(p.getId(), ALICE,
                new CreateProposalCommentRequest("x", UUID.randomUUID())))
            .isInstanceOf(ValidationException.class);
        limited.addComment(p.getId(), ALICE, new CreateProposalCommentRequest("uno", null));
        limited.addComment(p.getId(), ALICE, new CreateProposalCommentRequest("dos", null));
        assertThatThrownBy(() -> limited.addComment(p.getId(), ALICE, new CreateProposalCommentRequest("tres", null)))
            .isInstanceOf(RateLimitExceededException.class);
        assertThat(p.getCommentCount()).isEqualTo(2);
        limited.addComment(p.getId(), BOB, new CreateProposalCommentRequest("otro", null));
    }

    @Test
    void pendingProposalIsVisibleToAuthorAndModeratorsOnly() {
        Proposal p = stored(ProposalStatus.PENDING);
        assertThat(service.get(p.getId(), AUTHOR, false).isMine()).isTrue();
        assertThat(service.get(p.getId(), MOD, true).isMine()).isFalse();
        assertThatThrownBy(() -> service.get(p.getId(), ALICE, false))
            .isInstanceOf(ResourceNotFoundException.class);
        assertThatThrownBy(() -> service.listComments(p.getId(), ALICE, false, 1, 20))
            .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void rejectionReasonOnlyForAuthorAndModerators() {
        Proposal p = stored(ProposalStatus.PENDING);
        moderation.reject(p.getId(), MOD, " Duplicada ");
        assertThat(service.get(p.getId(), AUTHOR, false).rejectionReason()).isEqualTo("Duplicada");
        assertThat(service.get(p.getId(), MOD, true).rejectionReason()).isEqualTo("Duplicada");
    }

    // --- Moderation --------------------------------------------------------

    @Test
    void approvePublishesEventOnceAndRefusesToReModerate() {
        Proposal p = stored(ProposalStatus.PENDING);
        var res = moderation.approve(p.getId(), MOD);

        assertThat(res.status()).isEqualTo(ProposalStatus.APPROVED);
        assertThat(p.getModeratedBy()).isEqualTo(MOD);
        assertThat(p.getModeratedAt()).isNotNull();
        verify(events).publishEvent(new ProposalStatusChangedEvent(p.getId(), AUTHOR, "APPROVED"));

        assertThatThrownBy(() -> moderation.approve(p.getId(), MOD)).isInstanceOf(InvalidStateException.class);

        // Take-down of an approved proposal.
        moderation.reject(p.getId(), MOD, "Spam");
        assertThat(p.getStatus()).isEqualTo(ProposalStatus.REJECTED);
        verify(events).publishEvent(new ProposalStatusChangedEvent(p.getId(), AUTHOR, "REJECTED"));
        assertThatThrownBy(() -> moderation.reject(p.getId(), MOD, "Again")).isInstanceOf(InvalidStateException.class);
        assertThatThrownBy(() -> moderation.approve(p.getId(), MOD)).isInstanceOf(InvalidStateException.class);
    }

    @Test
    void lifecycleOnlyOnApprovedAndPublishesOnlyOnChange() {
        Proposal pending = stored(ProposalStatus.PENDING);
        assertThatThrownBy(() -> moderation.setLifecycle(pending.getId(), MOD, ProposalLifecycle.CERRADO))
            .isInstanceOf(InvalidStateException.class);

        Proposal p = stored(ProposalStatus.APPROVED);
        moderation.setLifecycle(p.getId(), MOD, ProposalLifecycle.ACEPTADO);
        moderation.setLifecycle(p.getId(), MOD, ProposalLifecycle.ACEPTADO);
        assertThat(p.getLifecycle()).isEqualTo(ProposalLifecycle.ACEPTADO);
        verify(events).publishEvent(new ProposalStatusChangedEvent(p.getId(), AUTHOR, "ACEPTADO"));
        verify(events, never()).publishEvent(new ProposalStatusChangedEvent(pending.getId(), AUTHOR, "CERRADO"));
    }

    @Test
    void moderatorCommentDeleteDecrementsOnlyOnce() {
        Proposal p = stored(ProposalStatus.APPROVED);
        p.adjustComments(1);
        var c = withId(new ProposalComment(p.getId(), ALICE, null, "Spam"));
        when(comments.findByIdAndProposalId(c.getId(), p.getId())).thenReturn(Optional.of(c));

        moderation.deleteComment(p.getId(), c.getId());
        moderation.deleteComment(p.getId(), c.getId());
        assertThat(c.isDeleted()).isTrue();
        assertThat(p.getCommentCount()).isZero();

        UUID missing = UUID.randomUUID();
        when(comments.findByIdAndProposalId(missing, p.getId())).thenReturn(Optional.empty());
        assertThatThrownBy(() -> moderation.deleteComment(p.getId(), missing))
            .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void pagingIsClamped() {
        assertThat(ProposalService.pageable(0, 500).getPageSize()).isEqualTo(ProposalService.MAX_PAGE_SIZE);
        assertThat(ProposalService.pageable(-3, 0).getPageNumber()).isZero();
        assertThat(ProposalService.pageable(3, 0).getPageSize()).isEqualTo(1);
    }
}
