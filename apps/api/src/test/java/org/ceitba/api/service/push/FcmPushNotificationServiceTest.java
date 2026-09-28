package org.ceitba.api.service.push;

import org.ceitba.api.repository.UserDeviceRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.Collection;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

// Batching and dead-token pruning of the FCM sender, against a fake gateway.
class FcmPushNotificationServiceTest {

    private static final PushMessage MSG = PushMessage.forResource("CEITBA", "Nueva nota", "article", "a1");

    FakePushGateway gateway;
    UserDeviceRepository devices;
    FcmPushNotificationService service;

    @BeforeEach
    void setUp() {
        gateway = new FakePushGateway();
        devices = mock(UserDeviceRepository.class);
        when(devices.deleteByTokens(anyCollection())).thenAnswer(inv -> ((Collection<?>) inv.getArgument(0)).size());
        service = new FcmPushNotificationService(gateway, devices);
    }

    private static List<String> tokens(int n) {
        return IntStream.range(0, n).mapToObj(i -> "tok-" + i).toList();
    }

    @SuppressWarnings("unchecked")
    private Collection<String> prunedTokens() {
        ArgumentCaptor<Collection<String>> captor = ArgumentCaptor.forClass(Collection.class);
        verify(devices).deleteByTokens(captor.capture());
        return captor.getValue();
    }

    @Test
    void splitsIntoBatchesOfAtMost500() {
        when(devices.findAllTokens()).thenReturn(tokens(1201));

        var result = service.broadcast(MSG);

        assertThat(gateway.calls()).extracting(c -> c.tokens().size()).containsExactly(500, 500, 201);
        assertThat(gateway.allTokens()).doesNotHaveDuplicates().hasSize(1201);
        assertThat(result).isEqualTo(new PushResult(1201, 1201, 0));
        verify(devices, never()).deleteByTokens(anyCollection());
    }

    @Test
    void prunesUnregisteredAndInvalidTokensButKeepsTransientFailures() {
        when(devices.findTokensOfOrgFollowers("it")).thenReturn(List.of("ok", "gone", "bad", "flaky"));
        gateway.answer("gone", PushGateway.Outcome.UNREGISTERED)
               .answer("bad", PushGateway.Outcome.INVALID_ARGUMENT)
               .answer("flaky", PushGateway.Outcome.FAILED);

        var result = service.sendToOrgFollowers("it", MSG);

        assertThat(prunedTokens()).containsExactlyInAnyOrder("gone", "bad");
        assertThat(result).isEqualTo(new PushResult(4, 1, 2));
    }

    @Test
    void aBatchRejectedEntirelyWithInvalidArgumentIsTreatedAsABadMessage() {
        when(devices.findAllTokens()).thenReturn(List.of("a", "b"));
        gateway.answer("a", PushGateway.Outcome.INVALID_ARGUMENT)
               .answer("b", PushGateway.Outcome.INVALID_ARGUMENT);

        var result = service.broadcast(MSG);

        verify(devices, never()).deleteByTokens(anyCollection());
        assertThat(result).isEqualTo(new PushResult(2, 0, 0));
    }

    @Test
    void anInvalidTokenIsPrunedWhenItIsTheOnlyTokenOfTheBatch() {
        when(devices.findTokensByUserIds(any())).thenReturn(List.of("bad"));
        gateway.answer("bad", PushGateway.Outcome.INVALID_ARGUMENT);

        var result = service.sendToUsers(Set.of(UUID.randomUUID()), MSG);

        assertThat(prunedTokens()).containsExactly("bad");
        assertThat(result).isEqualTo(new PushResult(1, 0, 1));
    }

    @Test
    void unregisteredIsPrunedEvenWhenItIsTheOnlyToken() {
        when(devices.findTokensByUserIds(any())).thenReturn(List.of("gone"));
        gateway.answer("gone", PushGateway.Outcome.UNREGISTERED);

        service.sendToUsers(Set.of(UUID.randomUUID()), MSG);

        assertThat(prunedTokens()).containsExactly("gone");
    }

    @Test
    void aFailedBatchIsSkippedAndTheRestStillGoOut() {
        var all = tokens(700);
        when(devices.findAllTokens()).thenReturn(all);
        gateway.failCall(0).answer("tok-600", PushGateway.Outcome.UNREGISTERED);

        var result = service.broadcast(MSG);

        assertThat(gateway.calls()).hasSize(2);
        assertThat(result).isEqualTo(new PushResult(700, 199, 1));
        assertThat(prunedTokens()).containsExactly("tok-600");
    }

    @Test
    void duplicateTokensAreSentOnce() {
        when(devices.findAllTokens()).thenReturn(List.of("x", "x", "y"));

        service.broadcast(MSG);

        assertThat(gateway.allTokens()).containsExactly("x", "y");
    }

    @Test
    void noRecipientsMeansNoCalls() {
        when(devices.findTokensOfOrgFollowers("nobody")).thenReturn(List.of());

        assertThat(service.sendToOrgFollowers("nobody", MSG)).isEqualTo(PushResult.NONE);
        assertThat(service.sendToUsers(Set.of(), MSG)).isEqualTo(PushResult.NONE);
        assertThat(service.sendToOrgFollowers(" ", MSG)).isEqualTo(PushResult.NONE);
        assertThat(gateway.calls()).isEmpty();
    }

    @Test
    void noOpServiceNeverTouchesAnything() {
        var noop = new NoOpPushNotificationService();
        assertThat(noop.broadcast(MSG)).isEqualTo(PushResult.NONE);
        assertThat(noop.sendToOrgFollowers("it", MSG)).isEqualTo(PushResult.NONE);
        assertThat(noop.sendToUsers(Set.of(UUID.randomUUID()), MSG)).isEqualTo(PushResult.NONE);
        verifyNoInteractions(devices);
    }
}
