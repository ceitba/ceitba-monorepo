package org.ceitba.api.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;
import java.util.List;

// Drive sync / Apuntes, bound from drive-sync.* (docs/DRIVE-SYNC.md):
//
//   DRIVE_SYNC_ENABLED=true                 scheduled job on (DriveSyncJob)
//   DRIVE_SYNC_INTERVAL=PT30M               delay between runs
//   DRIVE_SYNC_RUN_BUDGET=PT10M             max wall time of one run
//   DRIVE_SYNC_SERVICE_ACCOUNT_JSON=<base64 of the service-account key JSON>
//   DRIVE_SYNC_USE_FAKE=true                in-memory FakeDriveClient instead
//   DRIVE_SYNC_MAX_FILE_BYTES=52428800      bigger files: metadata only
//   DRIVE_SYNC_FAKE_DEMO_OWNERS=a@itba.edu.ar,b@itba.edu.ar   (fake only)
//   DRIVE_SYNC_SOURCE_BUDGET=PT3M           max time slice of one source per run
//   DRIVE_SYNC_REFERENCE_ABOVE_BYTES=20971520  bigger files: by reference (no copy)
//   DRIVE_SYNC_MAX_ITEMS_PER_SOURCE=20000   walk cap per source and generation
//   DRIVE_SYNC_MAX_DEPTH=30                 folders deeper than this are not listed
//   DRIVE_SYNC_COMMUNITY_ENABLED=true       expand community archives each run
//   DRIVE_SYNC_COMMUNITY_ONLY_CODES=71.88,72.08  (dev) only these subject folders
//
// The feature is usable (configured()) with a key or with the fake; without
// either the student endpoints answer 503 DRIVE_SYNC_UNCONFIGURED.
@ConfigurationProperties(prefix = "drive-sync")
public record DriveSyncProperties(
    boolean enabled,
    Duration interval,
    Duration runBudget,
    String serviceAccountJson,
    boolean useFake,
    Long maxFileBytes,
    List<String> fakeDemoOwners,
    Duration sourceBudget,
    Long referenceAboveBytes,
    Integer maxItemsPerSource,
    Integer maxDepth,
    Boolean communityEnabled,
    List<String> communityOnlyCodes
) {
    public DriveSyncProperties {
        interval = positiveOr(interval, Duration.ofMinutes(30));
        runBudget = positiveOr(runBudget, Duration.ofMinutes(10));
        maxFileBytes = maxFileBytes == null || maxFileBytes <= 0 ? 50L * 1024 * 1024 : maxFileBytes;
        fakeDemoOwners = fakeDemoOwners == null ? List.of()
            : fakeDemoOwners.stream().filter(s -> s != null && !s.isBlank()).map(String::trim).toList();
        sourceBudget = positiveOr(sourceBudget, Duration.ofMinutes(3));
        referenceAboveBytes = referenceAboveBytes == null || referenceAboveBytes <= 0 ? 20L * 1024 * 1024
            : referenceAboveBytes;
        maxItemsPerSource = maxItemsPerSource == null || maxItemsPerSource <= 0 ? 20_000 : maxItemsPerSource;
        maxDepth = maxDepth == null || maxDepth <= 0 ? 30 : maxDepth;
        communityEnabled = communityEnabled == null || communityEnabled;
        communityOnlyCodes = communityOnlyCodes == null ? List.of()
            : communityOnlyCodes.stream().filter(s -> s != null && !s.isBlank()).map(String::trim).toList();
    }

    public boolean configured() {
        return useFake || hasKey();
    }

    public boolean hasKey() {
        return serviceAccountJson != null && !serviceAccountJson.isBlank();
    }

    private static Duration positiveOr(Duration d, Duration fallback) {
        return d == null || d.isZero() || d.isNegative() ? fallback : d;
    }
}
