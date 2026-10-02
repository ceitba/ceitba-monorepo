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
import software.amazon.awssdk.core.checksums.RequestChecksumCalculation;
import software.amazon.awssdk.core.checksums.ResponseChecksumValidation;
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

import java.net.URI;
import java.time.Clock;
import java.time.Duration;

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
        return new S3ObjectStorage(presigner(props), client(props), props, clock);
    }

    // Server-side S3 calls (Drive sync put/delete), to internal-endpoint when
    // set. JDK HttpURLConnection-based client: no Netty/Apache on the path.
    public static S3Client client(StorageProperties props) {
        return S3Client.builder()
            .endpointOverride(URI.create(props.serverEndpoint()))
            .region(Region.of(props.region()))
            .credentialsProvider(StaticCredentialsProvider.create(
                AwsBasicCredentials.create(props.accessKeyId(), props.secretAccessKey())))
            .serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(true).build())
            // Plain Content-MD5-free PUTs: no aws-chunked trailer encoding.
            .requestChecksumCalculation(RequestChecksumCalculation.WHEN_REQUIRED)
            .responseChecksumValidation(ResponseChecksumValidation.WHEN_REQUIRED)
            .httpClientBuilder(UrlConnectionHttpClient.builder()
                .connectionTimeout(Duration.ofSeconds(10))
                .socketTimeout(Duration.ofMinutes(2)))
            .build();
    }

    // Path-style addressing (https://endpoint/bucket/key): MinIO serves the
    // bucket under the main host (no MINIO_DOMAIN, no extra DNS/TLS name), and
    // path style keeps the bucket out of the TLS hostname.
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
