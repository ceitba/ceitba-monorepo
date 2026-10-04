package org.ceitba.api.service.digest;

import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.Optional;

// Default: no per-recipient block. A real DigestPersonalSection bean replaces it.
@Configuration
class NoPersonalSection {

    @Bean
    @ConditionalOnMissingBean(DigestPersonalSection.class)
    DigestPersonalSection noDigestPersonalSection() {
        return (readerId, issue) -> Optional.empty();
    }
}
