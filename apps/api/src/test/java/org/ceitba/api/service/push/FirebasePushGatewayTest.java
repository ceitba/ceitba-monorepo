package org.ceitba.api.service.push;

import com.google.api.client.http.LowLevelHttpRequest;
import com.google.api.client.http.LowLevelHttpResponse;
import com.google.api.client.testing.http.MockHttpTransport;
import com.google.api.client.testing.http.MockLowLevelHttpRequest;
import com.google.api.client.testing.http.MockLowLevelHttpResponse;
import com.google.auth.oauth2.AccessToken;
import com.google.auth.oauth2.GoogleCredentials;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.messaging.MessagingErrorCode;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyPairGenerator;
import java.util.Base64;
import java.util.Date;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

// No network: checks error-code mapping, that a FirebaseApp + FirebaseMessaging
// can be built from a service-account JSON with the trimmed firebase-admin
// classpath (Firestore/Storage excluded), and the real sendEachForMulticast
// path against a mock FCM HTTP transport.
class FirebasePushGatewayTest {

    static String fakeServiceAccountJson() throws Exception {
        var gen = KeyPairGenerator.getInstance("RSA");
        gen.initialize(2048);
        var pem = "-----BEGIN PRIVATE KEY-----\\n"
            + Base64.getEncoder().encodeToString(gen.generateKeyPair().getPrivate().getEncoded())
            + "\\n-----END PRIVATE KEY-----\\n";
        return """
            {"type":"service_account","project_id":"demo-ceitba","private_key_id":"k1",
             "private_key":"%s","client_email":"push@demo-ceitba.iam.gserviceaccount.com",
             "client_id":"1","token_uri":"https://oauth2.googleapis.com/token"}
            """.formatted(pem);
    }

    @Test
    void mapsFcmErrorCodesToOutcomes() {
        assertThat(FirebasePushGateway.outcomeOf(MessagingErrorCode.UNREGISTERED))
            .isEqualTo(PushGateway.Outcome.UNREGISTERED);
        assertThat(FirebasePushGateway.outcomeOf(MessagingErrorCode.INVALID_ARGUMENT))
            .isEqualTo(PushGateway.Outcome.INVALID_ARGUMENT);
        assertThat(FirebasePushGateway.outcomeOf(MessagingErrorCode.SENDER_ID_MISMATCH))
            .isEqualTo(PushGateway.Outcome.FAILED);
        assertThat(FirebasePushGateway.outcomeOf(MessagingErrorCode.QUOTA_EXCEEDED))
            .isEqualTo(PushGateway.Outcome.FAILED);
        assertThat(FirebasePushGateway.outcomeOf((MessagingErrorCode) null))
            .isEqualTo(PushGateway.Outcome.FAILED);
    }

    @Test
    void buildsAMulticastMessage() {
        var msg = FirebasePushGateway.toMulticast(List.of("t1", "t2"),
            PushMessage.forResource("CEITBA", "Hola", "event", "e1"));
        assertThat(msg).isNotNull();
    }

    @Test
    void initializesFromAServiceAccountAndRejectsOversizedBatches() throws Exception {
        var json = fakeServiceAccountJson();
        try (var gw = FirebasePushGateway.fromServiceAccount(
                new ByteArrayInputStream(json.getBytes(StandardCharsets.UTF_8)))) {
            assertThat(gw.send(List.of(), PushMessage.forResource("t", "b", "x", "1"))).isEmpty();
            var tooMany = java.util.Collections.nCopies(PushGateway.MAX_TOKENS_PER_CALL + 1, "t");
            assertThatThrownBy(() -> gw.send(tooMany, PushMessage.forResource("t", "b", "x", "1")))
                .isInstanceOf(IllegalArgumentException.class);
        }
    }

    // FCM v1 answers: success for most tokens, the documented error bodies
    // for the ones named "dead-*" (UNREGISTERED) and "bad-*" (INVALID_ARGUMENT).
    private static MockHttpTransport fakeFcm(AtomicInteger requests) {
        return new MockHttpTransport() {
            @Override
            public LowLevelHttpRequest buildRequest(String method, String url) {
                return new MockLowLevelHttpRequest(url) {
                    @Override
                    public LowLevelHttpResponse execute() throws java.io.IOException {
                        requests.incrementAndGet();
                        String body = getContentAsString();
                        if (body.contains("dead-")) return error(404, "NOT_FOUND", "UNREGISTERED");
                        if (body.contains("bad-"))  return error(400, "INVALID_ARGUMENT", "INVALID_ARGUMENT");
                        if (body.contains("busy-")) return error(429, "RESOURCE_EXHAUSTED", "QUOTA_EXCEEDED");
                        return new MockLowLevelHttpResponse()
                            .setContentType("application/json")
                            .setContent("{\"name\":\"projects/demo-ceitba/messages/1\"}");
                    }
                };
            }
        };
    }

    private static MockLowLevelHttpResponse error(int http, String status, String fcmCode) {
        return new MockLowLevelHttpResponse()
            .setStatusCode(http)
            .setContentType("application/json")
            .setContent("""
                {"error":{"code":%d,"message":"x","status":"%s","details":[
                  {"@type":"type.googleapis.com/google.firebase.fcm.v1.FcmError","errorCode":"%s"}]}}
                """.formatted(http, status, fcmCode));
    }

    @Test
    void apnsPayloadIsContentAvailableSoIosCanRefreshTheInboxInTheBackground() {
        var bodies = new java.util.concurrent.CopyOnWriteArrayList<String>();
        var transport = new MockHttpTransport() {
            @Override
            public LowLevelHttpRequest buildRequest(String method, String url) {
                return new MockLowLevelHttpRequest(url) {
                    @Override
                    public LowLevelHttpResponse execute() throws java.io.IOException {
                        bodies.add(getContentAsString());
                        return new MockLowLevelHttpResponse()
                            .setContentType("application/json")
                            .setContent("{\"name\":\"projects/demo-ceitba/messages/1\"}");
                    }
                };
            }
        };
        var options = FirebaseOptions.builder()
            .setCredentials(GoogleCredentials.create(
                new AccessToken("test-access-token", new Date(System.currentTimeMillis() + 3_600_000))))
            .setProjectId("demo-ceitba")
            .setHttpTransport(transport)
            .build();
        try (var gw = new FirebasePushGateway(FirebaseApp.initializeApp(options, "test-" + UUID.randomUUID()))) {
            gw.send(List.of("ok-1"), PushMessage.forResource("CEITBA", "Hola", "article", "a1"));
        }
        assertThat(bodies).singleElement().satisfies(body -> {
            assertThat(body.replace(" ", "")).contains("\"content-available\":1");
            assertThat(body).contains("\"sound\":\"default\"");
        });
    }

    @Test
    void sendsThroughFirebaseMessagingAndMapsPerTokenErrors() {
        var requests = new AtomicInteger();
        var options = FirebaseOptions.builder()
            .setCredentials(GoogleCredentials.create(
                new AccessToken("test-access-token", new Date(System.currentTimeMillis() + 3_600_000))))
            .setProjectId("demo-ceitba")
            .setHttpTransport(fakeFcm(requests))
            .build();
        try (var gw = new FirebasePushGateway(FirebaseApp.initializeApp(options, "test-" + UUID.randomUUID()))) {
            var outcomes = gw.send(List.of("ok-1", "dead-1", "bad-1", "busy-1", "ok-2"),
                PushMessage.forResource("CEITBA", "Hola", "article", "a1"));

            assertThat(outcomes).containsExactly(
                PushGateway.Outcome.SENT,
                PushGateway.Outcome.UNREGISTERED,
                PushGateway.Outcome.INVALID_ARGUMENT,
                PushGateway.Outcome.FAILED,
                PushGateway.Outcome.SENT);
            assertThat(requests.get()).isEqualTo(5);
        }
    }
}
