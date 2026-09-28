package org.ceitba.api.service.push;

import java.util.List;

// The transport behind FcmPushNotificationService: one multicast call to FCM.
// FirebasePushGateway wraps FirebaseMessaging; tests plug in a fake bean of
// this type, which also switches the app from the NoOp to the FCM service.
public interface PushGateway {

    // FCM's per-call limit for sendEachForMulticast.
    int MAX_TOKENS_PER_CALL = 500;

    // Sends `message` to at most MAX_TOKENS_PER_CALL tokens. Returns one
    // outcome per token, in the same order. Throws PushDeliveryException when
    // the call as a whole fails (auth, network, quota).
    List<Outcome> send(List<String> tokens, PushMessage message);

    enum Outcome {
        SENT,
        // FCM: the app instance is gone (uninstalled, token expired/rotated).
        UNREGISTERED,
        // FCM: malformed token, or a malformed message.
        INVALID_ARGUMENT,
        // Anything else (transient, quota, sender mismatch). Kept.
        FAILED
    }
}
