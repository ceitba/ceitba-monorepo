package org.ceitba.api.service.drive;

import java.util.UUID;

// Published (inside the request transaction) to sync one source right after
// commit: on registration and on POST .../sync. See DriveSyncTrigger.
public record DriveSyncRequested(UUID sourceId) {}
