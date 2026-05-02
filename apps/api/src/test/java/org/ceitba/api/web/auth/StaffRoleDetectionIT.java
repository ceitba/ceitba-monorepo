package org.ceitba.api.web.auth;

import org.ceitba.api.domain.CeitbaBranch;
import org.ceitba.api.domain.CeitbaStaff;
import org.ceitba.api.domain.CeitbaStaffRole;
import org.ceitba.api.domain.User;
import org.ceitba.api.repository.CeitbaStaffRepository;
import org.ceitba.api.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import java.util.function.Consumer;

import static org.assertj.core.api.Assertions.assertThat;

// Drives the converter directly with a constructed Jwt — verifies that
// ROLE_STAFF is granted iff the user has an active CeitbaStaff row.
// Allowlist enforcement is tested at the HTTP layer in SubjectBookmarkAuthIT
// and UserEndpointsIT (via the AuthorizationManager in SecurityConfig).
@SpringBootTest
@Testcontainers
@TestPropertySource(properties = "auth.allowed-domains=itba.edu.ar")
class StaffRoleDetectionIT {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @DynamicPropertySource
    static void datasourceProps(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired StaffAwareJwtAuthenticationConverter converter;
    @Autowired UserRepository userRepository;
    @Autowired CeitbaStaffRepository staffRepository;
    @Autowired PlatformTransactionManager txManager;

    @BeforeEach
    void clean() {
        staffRepository.deleteAll();
        userRepository.deleteAll();
    }

    // CeitbaStaff has @OneToOne @MapsId on User. Saving CeitbaStaff with a
    // detached User reference makes Hibernate try to re-insert the user.
    // Doing the seed inside one transaction keeps the user managed.
    private void seedInTx(Consumer<UserRepository> work) {
        new TransactionTemplate(txManager).executeWithoutResult(s -> work.accept(userRepository));
    }

    private static Jwt jwtFor(String email) {
        return Jwt.withTokenValue("token")
            .header("alg", "RS256")
            .claim("email", email)
            .claim("name", email)
            .subject(email)
            .build();
    }

    @Test
    void freshUserGetsRoleUserOnly() {
        // No User row, no CeitbaStaff row. Baseline ROLE_USER is granted, no ROLE_STAFF.
        var auth = (JwtAuthenticationToken) converter.convert(jwtFor("alice@itba.edu.ar"));
        assertThat(auth.getAuthorities()).extracting(Object::toString)
            .containsExactly("ROLE_USER");
    }

    @Test
    void existingUserWithoutStaffRowGetsRoleUserOnly() {
        seedInTx(repo -> repo.save(new User(UUID.randomUUID(), "alice@itba.edu.ar", "Alice")));
        var auth = (JwtAuthenticationToken) converter.convert(jwtFor("alice@itba.edu.ar"));
        assertThat(auth.getAuthorities()).extracting(Object::toString)
            .containsExactly("ROLE_USER");
    }

    @Test
    void userWithActiveStaffRowGetsRoleStaff() {
        seedInTx(repo -> {
            var alice = repo.save(new User(UUID.randomUUID(), "alice@itba.edu.ar", "Alice"));
            staffRepository.save(new CeitbaStaff(alice, CeitbaBranch.IT, CeitbaStaffRole.MEMBER,
                OffsetDateTime.now().minus(1, ChronoUnit.DAYS),
                OffsetDateTime.now().plus(30, ChronoUnit.DAYS)));
        });

        var auth = (JwtAuthenticationToken) converter.convert(jwtFor("alice@itba.edu.ar"));
        assertThat(auth.getAuthorities()).extracting(Object::toString)
            .containsExactlyInAnyOrder("ROLE_USER", "ROLE_STAFF");
    }

    @Test
    void userWithExpiredStaffRowGetsRoleUserOnly() {
        seedInTx(repo -> {
            var alice = repo.save(new User(UUID.randomUUID(), "alice@itba.edu.ar", "Alice"));
            staffRepository.save(new CeitbaStaff(alice, CeitbaBranch.IT, CeitbaStaffRole.MEMBER,
                OffsetDateTime.now().minus(60, ChronoUnit.DAYS),
                OffsetDateTime.now().minus(30, ChronoUnit.DAYS)));
        });

        var auth = (JwtAuthenticationToken) converter.convert(jwtFor("alice@itba.edu.ar"));
        assertThat(auth.getAuthorities()).extracting(Object::toString)
            .containsExactly("ROLE_USER");
    }

    @Test
    void userWithFutureStaffRowGetsRoleUserOnly() {
        seedInTx(repo -> {
            var alice = repo.save(new User(UUID.randomUUID(), "alice@itba.edu.ar", "Alice"));
            staffRepository.save(new CeitbaStaff(alice, CeitbaBranch.IT, CeitbaStaffRole.MEMBER,
                OffsetDateTime.now().plus(30, ChronoUnit.DAYS),
                OffsetDateTime.now().plus(60, ChronoUnit.DAYS)));
        });

        var auth = (JwtAuthenticationToken) converter.convert(jwtFor("alice@itba.edu.ar"));
        assertThat(auth.getAuthorities()).extracting(Object::toString)
            .containsExactly("ROLE_USER");
    }
}
