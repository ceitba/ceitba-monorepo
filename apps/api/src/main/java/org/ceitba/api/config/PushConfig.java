package org.ceitba.api.config;

import org.ceitba.api.repository.UserDeviceRepository;
import org.ceitba.api.service.push.FcmPushNotificationService;
import org.ceitba.api.service.push.FirebasePushGateway;
import org.ceitba.api.service.push.NoOpPushNotificationService;
import org.ceitba.api.service.push.PushGateway;
import org.ceitba.api.service.push.PushNotificationService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Conditional;
import org.springframework.context.annotation.Condition;
import org.springframework.context.annotation.ConditionContext;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.type.AnnotatedTypeMetadata;
import org.springframework.scheduling.annotation.EnableAsync;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;

// Push wiring. The FCM service is used whenever a PushGateway bean exists:
// the Firebase one when a service account is configured (PushProperties), or
// a fake one registered by a test. Otherwise pushes go to the NoOp service.
//
// @EnableAsync backs PushTriggerListener, which runs on Boot's
// applicationTaskExecutor (spring.task.execution.*). No Executor bean is
// declared here on purpose: one would replace Boot's default executor.
@Configuration
@EnableAsync
@EnableConfigurationProperties(PushProperties.class)
public class PushConfig {

    private static final Logger log = LoggerFactory.getLogger(PushConfig.class);

    // Fails startup when credentials are configured but unreadable, rather
    // than silently running without pushes.
    @Bean
    @Conditional(FirebaseConfigured.class)
    public FirebasePushGateway firebasePushGateway(PushProperties props) throws IOException {
        try (InputStream in = open(props)) {
            log.info("FCM push enabled");
            return FirebasePushGateway.fromServiceAccount(in);
        }
    }

    @Bean
    public PushNotificationService pushNotificationService(ObjectProvider<PushGateway> gateway,
                                                           UserDeviceRepository devices) {
        var gw = gateway.getIfAvailable();
        if (gw == null) {
            log.info("FCM push disabled (FIREBASE_SERVICE_ACCOUNT_JSON / _PATH not set)");
            return new NoOpPushNotificationService();
        }
        return new FcmPushNotificationService(gw, devices);
    }

    static InputStream open(PushProperties props) throws IOException {
        if (props.serviceAccountJson() != null) {
            var raw = props.serviceAccountJson();
            byte[] json = raw.startsWith("{")
                ? raw.getBytes(StandardCharsets.UTF_8)
                : Base64.getMimeDecoder().decode(raw);
            return new ByteArrayInputStream(json);
        }
        return Files.newInputStream(Path.of(props.serviceAccountPath()));
    }

    static class FirebaseConfigured implements Condition {
        @Override
        public boolean matches(ConditionContext context, AnnotatedTypeMetadata metadata) {
            var env = context.getEnvironment();
            return hasText(env.getProperty("push.fcm.service-account-json"))
                || hasText(env.getProperty("push.fcm.service-account-path"));
        }

        private static boolean hasText(String s) {
            return s != null && !s.isBlank();
        }
    }
}
