package org.ceitba.api.service.capability;

import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.common.exception.ValidationException;
import org.ceitba.api.domain.User;
import org.ceitba.api.domain.capability.CapabilityOrgGrant;
import org.ceitba.api.domain.capability.CapabilitySetting;
import org.ceitba.api.domain.capability.CapabilityUserGrant;
import org.ceitba.api.domain.news.Organization;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.repository.capability.CapabilityOrgGrantRepository;
import org.ceitba.api.repository.capability.CapabilitySettingRepository;
import org.ceitba.api.repository.capability.CapabilityUserGrantRepository;
import org.ceitba.api.repository.news.OrganizationRepository;
import org.ceitba.api.repository.news.UserOrganizationRepository;
import org.ceitba.api.web.capability.dto.CapabilityGrantsResponse;
import org.ceitba.api.web.capability.dto.CapabilityResponse;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.Arrays;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

// STAFF management of capabilities (/v1/staff/capabilities, docs/CAPABILITIES.md).
// Grants are idempotent: re-granting keeps the original row, revoking a
// missing grant is a no-op. No allowlist check: the allowlist governs login.
@Service
public class CapabilityAdminService {

    private static final Pattern EMAIL = Pattern.compile("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$");

    private final CapabilitySettingRepository settings;
    private final CapabilityUserGrantRepository userGrants;
    private final CapabilityOrgGrantRepository orgGrants;
    private final OrganizationRepository organizations;
    private final UserOrganizationRepository memberships;
    private final UserRepository users;
    private final Clock clock;

    public CapabilityAdminService(CapabilitySettingRepository settings,
                                  CapabilityUserGrantRepository userGrants,
                                  CapabilityOrgGrantRepository orgGrants,
                                  OrganizationRepository organizations,
                                  UserOrganizationRepository memberships,
                                  UserRepository users,
                                  Clock clock) {
        this.settings = settings;
        this.userGrants = userGrants;
        this.orgGrants = orgGrants;
        this.organizations = organizations;
        this.memberships = memberships;
        this.users = users;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public List<CapabilityResponse> list() {
        return Arrays.stream(Capability.values()).map(this::describe).toList();
    }

    @Transactional
    public CapabilityResponse setEnabledForAll(String key, boolean enabled, UUID by) {
        Capability capability = resolve(key);
        CapabilitySetting setting = settings.findById(capability.key())
            .orElseGet(() -> new CapabilitySetting(capability.key()));
        setting.setEnabledForAll(enabled, by, now());
        settings.save(setting);
        return describe(capability);
    }

    @Transactional(readOnly = true)
    public CapabilityGrantsResponse grants(String key) {
        Capability capability = resolve(key);
        List<CapabilityUserGrant> ug = userGrants.findByCapabilityOrderByEmail(capability.key());
        List<CapabilityOrgGrant> og = orgGrants.findByCapabilityOrderByOrgSlug(capability.key());

        Set<UUID> granterIds = new LinkedHashSet<>();
        ug.stream().map(CapabilityUserGrant::getGrantedBy).filter(Objects::nonNull).forEach(granterIds::add);
        og.stream().map(CapabilityOrgGrant::getGrantedBy).filter(Objects::nonNull).forEach(granterIds::add);
        Map<UUID, User> granters = byId(users.findAllById(granterIds));

        Map<String, User> byEmail = ug.isEmpty() ? Map.of()
            : users.findByLowerEmailIn(ug.stream().map(CapabilityUserGrant::getEmail).toList()).stream()
                .collect(Collectors.toMap(u -> u.getEmail().toLowerCase(Locale.ROOT), Function.identity(), (a, b) -> a));
        Map<String, Organization> orgs = organizations.findAllById(og.stream().map(CapabilityOrgGrant::getOrgSlug).toList())
            .stream().collect(Collectors.toMap(Organization::getSlug, Function.identity()));

        var userItems = ug.stream().map(g -> {
            User u = byEmail.get(g.getEmail());
            return new CapabilityGrantsResponse.UserGrant(g.getEmail(),
                u != null ? u.getId() : null, u != null ? u.getName() : null,
                g.getGrantedAt(), nameOf(granters, g.getGrantedBy()));
        }).toList();
        var orgItems = og.stream().map(g -> {
            Organization o = orgs.get(g.getOrgSlug());
            return new CapabilityGrantsResponse.OrgGrant(g.getOrgSlug(), o != null ? o.getName() : null,
                memberships.countByOrganization(g.getOrgSlug()),
                g.getGrantedAt(), nameOf(granters, g.getGrantedBy()));
        }).toList();
        return new CapabilityGrantsResponse(userItems, orgItems);
    }

    @Transactional
    public CapabilityGrantsResponse grantUsers(String key, Collection<String> emails, UUID by) {
        Capability capability = resolve(key);
        Set<String> normalized = new LinkedHashSet<>();
        for (String raw : emails) {
            String email = raw == null ? "" : raw.trim().toLowerCase(Locale.ROOT);
            if (email.length() > 320 || !EMAIL.matcher(email).matches()) {
                throw new ValidationException("emails", raw, "is not a valid email");
            }
            normalized.add(email);
        }
        OffsetDateTime at = now();
        for (String email : normalized) {
            if (!userGrants.existsById(new CapabilityUserGrant.Id(capability.key(), email))) {
                userGrants.save(new CapabilityUserGrant(capability.key(), email, by, at));
            }
        }
        return grants(key);
    }

    @Transactional
    public CapabilityGrantsResponse revokeUser(String key, String email) {
        Capability capability = resolve(key);
        userGrants.deleteById(new CapabilityUserGrant.Id(capability.key(), email.trim().toLowerCase(Locale.ROOT)));
        return grants(key);
    }

    @Transactional
    public CapabilityGrantsResponse grantOrg(String key, String slug, UUID by) {
        Capability capability = resolve(key);
        if (!organizations.existsById(slug)) throw new ResourceNotFoundException("Organization", slug);
        if (!orgGrants.existsById(new CapabilityOrgGrant.Id(capability.key(), slug))) {
            orgGrants.save(new CapabilityOrgGrant(capability.key(), slug, by, now()));
        }
        return grants(key);
    }

    @Transactional
    public CapabilityGrantsResponse revokeOrg(String key, String slug) {
        Capability capability = resolve(key);
        orgGrants.deleteById(new CapabilityOrgGrant.Id(capability.key(), slug));
        return grants(key);
    }

    private CapabilityResponse describe(Capability c) {
        boolean all = settings.findById(c.key()).map(CapabilitySetting::isEnabledForAll).orElse(false);
        return new CapabilityResponse(c.key(), c.label(), c.description(), all,
            userGrants.countByCapability(c.key()), orgGrants.countByCapability(c.key()));
    }

    private static Capability resolve(String key) {
        return Capability.fromKey(key).orElseThrow(() -> new ResourceNotFoundException("Capability", key));
    }

    private static Map<UUID, User> byId(List<User> list) {
        return list.stream().collect(Collectors.toMap(User::getId, Function.identity()));
    }

    private static String nameOf(Map<UUID, User> users, UUID id) {
        User u = id == null ? null : users.get(id);
        return u != null ? u.getName() : null;
    }

    private OffsetDateTime now() {
        // UTC, microseconds: the same shape the row reads back as.
        return OffsetDateTime.now(clock).withOffsetSameInstant(ZoneOffset.UTC).truncatedTo(ChronoUnit.MICROS);
    }
}
