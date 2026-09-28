package org.ceitba.api.service.push;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;

// @Import into an IT to run the real FcmPushNotificationService (recipient
// resolution, batching, pruning) against an in-memory gateway instead of FCM.
@TestConfiguration(proxyBeanMethods = false)
public class FakePushGatewayConfig {

    @Bean
    public FakePushGateway fakePushGateway() {
        return new FakePushGateway();
    }
}
