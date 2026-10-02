package org.ceitba.api.domain.drive;

// Lifecycle of a registered Drive folder (docs/DRIVE-SYNC.md).
public enum DriveSourceStatus {
    // Registered, waiting for STAFF approval; synced, nothing published yet.
    PENDING_REVIEW,
    // Synced and published.
    ACTIVE,
    // STAFF blocked it: not synced, nothing published.
    BLOCKED,
    // The bot lost access to the root folder (unshared or deleted).
    REVOKED,
    // The student disconnected it; its files were deleted.
    DISCONNECTED,
    // 5 consecutive failed syncs; still retried, approved content stays up.
    ERROR
}
