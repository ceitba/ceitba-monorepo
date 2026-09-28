package org.ceitba.api.service.push;

import com.google.auth.oauth2.GoogleCredentials;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.messaging.AndroidConfig;
import com.google.firebase.messaging.ApnsConfig;
import com.google.firebase.messaging.Aps;
import com.google.firebase.messaging.BatchResponse;
import com.google.firebase.messaging.FirebaseMessaging;
import com.google.firebase.messaging.FirebaseMessagingException;
import com.google.firebase.messaging.MessagingErrorCode;
import com.google.firebase.messaging.MulticastMessage;
import com.google.firebase.messaging.Notification;
import com.google.firebase.messaging.SendResponse;

import java.io.IOException;
import java.io.InputStream;
import java.util.List;

// PushGateway over the Firebase Admin SDK (FCM HTTP v1, sendEachForMulticast).
// Owns a named FirebaseApp built from a service-account JSON; close() deletes
// it (Spring calls it on shutdown).
public class FirebasePushGateway implements PushGateway, AutoCloseable {

    static final String APP_NAME = "ceitba-push";

    private final FirebaseApp app;
    private final FirebaseMessaging messaging;

    FirebasePushGateway(FirebaseApp app) {
        this.app       = app;
        this.messaging = FirebaseMessaging.getInstance(app);
    }

    public static FirebasePushGateway fromServiceAccount(InputStream serviceAccountJson) throws IOException {
        var credentials = GoogleCredentials.fromStream(serviceAccountJson);
        var options = FirebaseOptions.builder().setCredentials(credentials).build();
        return new FirebasePushGateway(FirebaseApp.initializeApp(options, APP_NAME));
    }

    @Override
    public List<Outcome> send(List<String> tokens, PushMessage message) {
        if (tokens.isEmpty()) return List.of();
        if (tokens.size() > MAX_TOKENS_PER_CALL) {
            throw new IllegalArgumentException("At most " + MAX_TOKENS_PER_CALL + " tokens per call");
        }
        BatchResponse response;
        try {
            response = messaging.sendEachForMulticast(toMulticast(tokens, message));
        } catch (FirebaseMessagingException e) {
            throw new PushDeliveryException("FCM multicast failed: " + e.getMessagingErrorCode(), e);
        }
        return response.getResponses().stream().map(FirebasePushGateway::outcomeOf).toList();
    }

    static MulticastMessage toMulticast(List<String> tokens, PushMessage message) {
        return MulticastMessage.builder()
            .addAllTokens(tokens)
            .setNotification(Notification.builder()
                .setTitle(message.title())
                .setBody(message.body())
                .build())
            .putAllData(message.data())
            .setAndroidConfig(AndroidConfig.builder()
                .setPriority(AndroidConfig.Priority.HIGH)
                .build())
            // content-available wakes the iOS app in the background too, so
            // it can refresh its inbox before the user opens the alert.
            .setApnsConfig(ApnsConfig.builder()
                .setAps(Aps.builder().setSound("default").setContentAvailable(true).build())
                .build())
            .build();
    }

    static Outcome outcomeOf(SendResponse r) {
        if (r.isSuccessful()) return Outcome.SENT;
        return outcomeOf(r.getException() == null ? null : r.getException().getMessagingErrorCode());
    }

    static Outcome outcomeOf(MessagingErrorCode code) {
        if (code == MessagingErrorCode.UNREGISTERED)     return Outcome.UNREGISTERED;
        if (code == MessagingErrorCode.INVALID_ARGUMENT) return Outcome.INVALID_ARGUMENT;
        return Outcome.FAILED;
    }

    @Override
    public void close() {
        app.delete();
    }
}
