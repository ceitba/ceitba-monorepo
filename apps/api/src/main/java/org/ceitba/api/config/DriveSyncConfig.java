package org.ceitba.api.config;

import org.ceitba.api.external.drive.DriveClient;
import org.ceitba.api.external.drive.FakeDriveClient;
import org.ceitba.api.external.drive.GoogleDriveClient;
import org.ceitba.api.external.drive.UnconfiguredDriveClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

// Picks the DriveClient: the in-memory fake (drive-sync.use-fake), the real
// Drive API with the service-account key, or a disabled client. A key that
// cannot be parsed never stops the app: it is logged and the feature is off.
@Configuration
@EnableConfigurationProperties(DriveSyncProperties.class)
public class DriveSyncConfig {

    private static final Logger log = LoggerFactory.getLogger(DriveSyncConfig.class);

    @Bean
    public DriveClient driveClient(DriveSyncProperties props) {
        if (props.useFake()) {
            var fake = new FakeDriveClient();
            props.fakeDemoOwners().forEach(fake::seedDemo);
            log.info("Drive sync: using FakeDriveClient (demo owners: {})", props.fakeDemoOwners());
            return fake;
        }
        if (!props.hasKey()) {
            log.info("Drive sync: not configured (DRIVE_SYNC_SERVICE_ACCOUNT_JSON); /v1/me/drive answers 503");
            return new UnconfiguredDriveClient();
        }
        try {
            var client = new GoogleDriveClient(props.serviceAccountJson());
            log.info("Drive sync: Google Drive as {}", client.botEmail());
            return client;
        } catch (RuntimeException e) {
            log.error("Drive sync: DISABLED, the service-account key is unusable: {}", e.getMessage());
            return new UnconfiguredDriveClient();
        }
    }
}
