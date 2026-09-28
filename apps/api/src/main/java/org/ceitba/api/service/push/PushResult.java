package org.ceitba.api.service.push;

// Outcome of one fan-out: how many device tokens were targeted, how many FCM
// accepted, and how many dead tokens were deleted from user_devices.
public record PushResult(int targeted, int sent, int pruned) {

    public static final PushResult NONE = new PushResult(0, 0, 0);
}
