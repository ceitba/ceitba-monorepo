package org.ceitba.api.service.proposal;

import org.ceitba.api.domain.ProposalStatus;
import org.ceitba.api.domain.proposal.Proposal;
import org.ceitba.api.domain.proposal.ProposalLifecycle;
import org.ceitba.api.domain.proposal.ProposalTopic;
import org.ceitba.api.repository.proposal.ProposalRepository;
import org.ceitba.api.service.push.events.PushToUsers;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.ApplicationEventPublisher;

import java.util.Arrays;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class ProposalStatusPushNotifierTest {

    private ProposalRepository proposals;
    private ApplicationEventPublisher events;
    private ProposalStatusPushNotifier notifier;

    @BeforeEach
    void setUp() {
        proposals = mock(ProposalRepository.class);
        events = mock(ApplicationEventPublisher.class);
        notifier = new ProposalStatusPushNotifier(proposals, events);
    }

    @Test
    void everyStatusAModeratorCanSetHasATitle() {
        Arrays.stream(ProposalStatus.values())
            .filter(s -> s != ProposalStatus.PENDING)
            .forEach(s -> assertThat(ProposalStatusPushNotifier.titleFor(s.name())).as(s.name()).isNotBlank());
        Arrays.stream(ProposalLifecycle.values())
            .forEach(l -> assertThat(ProposalStatusPushNotifier.titleFor(l.name())).as(l.name()).isNotBlank());
        assertThat(ProposalStatusPushNotifier.titleFor("PENDING")).isNull();
        assertThat(ProposalStatusPushNotifier.titleFor(null)).isNull();
    }

    @Test
    void publishesAPushToUsersTriggerForTheAuthor() {
        UUID id = UUID.randomUUID();
        UUID author = UUID.randomUUID();
        when(proposals.findById(id)).thenReturn(Optional.of(new Proposal(author, "Más microondas", "d", ProposalTopic.CEITBA)));

        notifier.on(new ProposalStatusChangedEvent(id, author, "APPROVED"));

        var captor = ArgumentCaptor.forClass(Object.class);
        verify(events).publishEvent(captor.capture());
        assertThat(captor.getValue()).isInstanceOfSatisfying(PushToUsers.class, t -> {
            assertThat(t.userIds()).containsExactly(author);
            assertThat(t.message().title()).isEqualTo("Tu propuesta fue aprobada");
            assertThat(t.message().body()).isEqualTo("Más microondas");
            assertThat(t.message().data()).containsEntry("type", "proposal").containsEntry("id", id.toString());
        });
    }

    @Test
    void noAuthorOrUnknownStatusOrMissingProposalPublishesNothing() {
        UUID id = UUID.randomUUID();
        notifier.on(new ProposalStatusChangedEvent(id, null, "APPROVED"));
        notifier.on(new ProposalStatusChangedEvent(id, UUID.randomUUID(), "SOMETHING_ELSE"));
        verifyNoInteractions(proposals);

        when(proposals.findById(id)).thenReturn(Optional.empty());
        notifier.on(new ProposalStatusChangedEvent(id, UUID.randomUUID(), "CERRADO"));
        verify(events, never()).publishEvent(any(Object.class));
    }
}
