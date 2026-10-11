package org.ceitba.api.service.capability;

import org.ceitba.api.domain.User;
import org.ceitba.api.repository.CeitbaStaffRepository;
import org.ceitba.api.repository.capability.CapabilityOrgGrantRepository;
import org.ceitba.api.repository.capability.CapabilitySettingRepository;
import org.ceitba.api.repository.capability.CapabilityUserGrantRepository;
import org.ceitba.api.service.auth.ApiKeyScope;
import org.ceitba.api.service.auth.ApiKeyService;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.lang.reflect.Proxy;
import java.time.Clock;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

// The effective-capability rule: staff, enabled_for_all, email grant, org grant.
class CapabilityServiceTest {

    private static final User USER = new User(UUID.randomUUID(), "Alumno@ITBA.edu.ar", "A");

    @Test
    void effectiveCapabilityRule() {
        assertThat(service(false, List.of(), List.of(), List.of()).effective(USER)).isEmpty();
        assertThat(service(true, List.of(), List.of(), List.of()).effective(USER))
            .containsExactly("apuntes", "asistentes_ia", "resumen_semanal");
        assertThat(service(false, List.of("apuntes"), List.of(), List.of()).effective(USER)).containsExactly("apuntes");
        // Email grants are looked up lowercased; unknown keys in the tables are ignored.
        assertThat(service(false, List.of(), List.of("apuntes", "gone"), List.of()).effective(USER))
            .containsExactly("apuntes");
        assertThat(service(false, List.of(), List.of(), List.of("apuntes")).effective(USER)).containsExactly("apuntes");

        assertThatThrownBy(() -> service(false, List.of(), List.of(), List.of()).require(USER, Capability.APUNTES))
            .isInstanceOf(CapabilityRequiredException.class);
    }

    // Capabilities are not staff powers: a staff member's key without the
    // "staff" scope keeps them (apps/mcp checks asistentes_ia with such keys).
    @Test
    void aKeyWithoutStaffScopeKeepsStaffCapabilities() {
        var key = new ApiKeyService.ValidatedKey(UUID.randomUUID(), USER, ApiKeyScope.normalize(List.of()));
        var auth = new UsernamePasswordAuthenticationToken(USER, null, List.of());
        auth.setDetails(key);
        SecurityContextHolder.getContext().setAuthentication(auth);
        try {
            assertThat(service(true, List.of(), List.of(), List.of()).effective(USER))
                .containsExactly("apuntes", "asistentes_ia", "resumen_semanal");
        } finally {
            SecurityContextHolder.clearContext();
        }
    }

    private static CapabilityService service(boolean staff, List<String> forAll, List<String> byEmail, List<String> byOrg) {
        return new CapabilityService(
            stub(CeitbaStaffRepository.class, "isActiveStaff", args -> staff),
            stub(CapabilitySettingRepository.class, "findEnabledForAll", args -> forAll),
            stub(CapabilityUserGrantRepository.class, "findCapabilitiesByEmail",
                args -> "alumno@itba.edu.ar".equals(args[0]) ? byEmail : List.of()),
            stub(CapabilityOrgGrantRepository.class, "findCapabilitiesByMember",
                args -> USER.getId().equals(args[0]) ? byOrg : List.of()),
            Clock.systemUTC());
    }

    @SuppressWarnings("unchecked")
    private static <T> T stub(Class<T> type, String method, java.util.function.Function<Object[], Object> answer) {
        return (T) Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[] {type}, (proxy, m, args) -> {
            if (!m.getName().equals(method)) throw new UnsupportedOperationException(m.getName());
            return answer.apply(args);
        });
    }
}
