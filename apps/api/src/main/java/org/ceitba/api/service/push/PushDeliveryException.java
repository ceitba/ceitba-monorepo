package org.ceitba.api.service.push;

// A whole FCM call failed (credentials, network, quota). Never reaches a
// controller: pushes run on a background thread and failures are logged.
public class PushDeliveryException extends RuntimeException {

    public PushDeliveryException(String message, Throwable cause) {
        super(message, cause);
    }
}
