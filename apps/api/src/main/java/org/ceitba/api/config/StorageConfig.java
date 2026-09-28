package org.ceitba.api.config;

import org.ceitba.api.service.media.ObjectStorage;
import org.ceitba.api.service.media.S3ObjectStorage;
import org.ceitba.api.service.media.UnconfiguredObjectStorage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

import java.net.URI;
import java.time.Clock;

@Configuration
@EnableConfigurationProperties(StorageProperties.class)
public class StorageConfig {

    private static final Logger log = LoggerFactory.getLogger(StorageConfig.class);

    @Bean
    public ObjectStorage objectStorage(StorageProperties props, Clock clock) {
        if (!props.configured()) {
            log.info("Object storage not configured (storage.*); upload signing returns 501");
            return new UnconfiguredObjectStorage();
        }
        return new S3ObjectStorage(presigner(props), props, clock);
    }

    // Path-style addressing (https://endpoint/bucket/key): R2 accepts both,
    // and path style keeps the bucket out of the TLS hostname.
    public static S3Presigner presigner(StorageProperties props) {
        return S3Presigner.builder()
            .endpointOverride(URI.create(props.endpoint()))
            .region(Region.of(props.region()))
            .credentialsProvider(StaticCredentialsProvider.create(
                AwsBasicCredentials.create(props.accessKeyId(), props.secretAccessKey())))
            .serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(true).build())
            .build();
    }
}
