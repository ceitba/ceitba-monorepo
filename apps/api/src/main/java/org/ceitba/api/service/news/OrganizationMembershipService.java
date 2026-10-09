package org.ceitba.api.service.news;

import org.ceitba.api.common.exception.ResourceAlreadyExistsException;
import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.common.exception.ValidationException;
import org.ceitba.api.config.AuthProperties;
import org.ceitba.api.domain.User;
import org.ceitba.api.domain.news.UserOrganization;
import org.ceitba.api.domain.news.UserOrganizationId;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.repository.news.OrgInviteRepository;
import org.ceitba.api.repository.news.OrganizationRepository;
import org.ceitba.api.repository.news.UserOrganizationRepository;
import org.ceitba.api.service.push.PushMessage;
import org.ceitba.api.service.push.events.PushToUsers;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
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

// Organization memberships (docs/ORGANIZATIONS.md). STAFF manages anyone's
// (UserMembershipsController); an org's admins manage their own org's
// (OrgMembersController). Removing or demoting an admin, leaving, and account
// deletion go through the last-admin guard so an org keeps an admin once it
// has one; STAFF (the escape hatch, e.g. an org nobody runs any more) skips it.
@Service
public class OrganizationMembershipService {

    public static final String ADMIN_ROLE = "admin";
    public static final String MEMBER_ROLE = "member";

    // V9 keeps `role` as free TEXT; this is the set the code actually acts on
    // (ADMIN_ROLE manages members and sees followers), so writes are limited to it.
    public static final List<String> ROLES = List.of(MEMBER_ROLE, ADMIN_ROLE);

    static final int MAX_INVITES_PER_REQUEST = 50;
    static final int MAX_TITLE_LENGTH = 60;
    private static final Pattern EMAIL = Pattern.compile("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$");

    private final UserOrganizationRepository repo;
    private final OrganizationRepository orgRepo;
    private final OrgInviteRepository invites;
    private final UserRepository users;
    private final AuthProperties auth;
    private final ApplicationEventPublisher events;

    public OrganizationMembershipService(UserOrganizationRepository repo,
                                          OrganizationRepository orgRepo,
                                          OrgInviteRepository invites,
                                          UserRepository users,
                                          AuthProperties auth,
                                          ApplicationEventPublisher events) {
        this.repo = repo;
        this.orgRepo = orgRepo;
        this.invites = invites;
        this.users = users;
        this.auth = auth;
        this.events = events;
    }

    public record MemberView(UUID userId, String name, String email, String avatarUrl, String role,
                             String title, boolean showOnPortal, OffsetDateTime since) {}

    public record InviteView(String email, String role, OffsetDateTime createdAt) {}

    public record BoardMemberView(String name, String title, String avatarUrl) {}

    // Existing users added right away, and emails left pending until their first login.
    public record InviteResult(List<MemberView> added, List<InviteView> pending) {}

    public List<UserOrganization> listForUser(UUID userId) {
        return repo.findByUserId(userId);
    }

    public boolean userBelongsTo(UUID userId, String orgSlug) {
        if (userId == null || orgSlug == null) return false;
        return repo.existsByUserIdAndOrganization(userId, orgSlug);
    }

    @Transactional(readOnly = true)
    public boolean userIsAdminOf(UUID userId, String orgSlug) {
        if (userId == null || orgSlug == null) return false;
        return repo.existsByUserIdAndOrganizationAndRole(userId, orgSlug, ADMIN_ROLE);
    }

    @Transactional(readOnly = true)
    public List<MemberView> members(String orgSlug) {
        requireOrg(orgSlug);
        var memberships = repo.findByOrganization(orgSlug);
        var byId = usersById(memberships.stream().map(UserOrganization::getUserId).toList());
        return memberships.stream()
            .map(m -> view(m, byId.get(m.getUserId())))
            .sorted(Comparator.comparing((MemberView v) -> !ADMIN_ROLE.equals(v.role()))
                .thenComparing(v -> v.name() == null ? "" : v.name().toLowerCase(Locale.ROOT)))
            .toList();
    }

    @Transactional(readOnly = true)
    public List<InviteView> invites(String orgSlug) {
        requireOrg(orgSlug);
        return invites.findByOrganizationOrderByEmail(orgSlug).stream()
            .map(i -> new InviteView(i.getEmail(), i.getRole(), i.getCreatedAt()))
            .toList();
    }

    // Public board of the portal: members who opted in, oldest first. No emails.
    @Transactional(readOnly = true)
    public List<BoardMemberView> board(String orgSlug) {
        var memberships = repo.findByOrganizationAndShowOnPortalTrueOrderByCreatedAt(orgSlug);
        var byId = usersById(memberships.stream().map(UserOrganization::getUserId).toList());
        return memberships.stream()
            .filter(m -> byId.containsKey(m.getUserId()))
            .map(m -> {
                var u = byId.get(m.getUserId());
                return new BoardMemberView(u.getName(), m.getTitle(), u.getAvatarUrl());
            })
            .toList();
    }

    @Transactional
    public UserOrganization add(UUID userId, String orgSlug, String role) {
        return add(userId, orgSlug, role, null);
    }

    @Transactional
    public UserOrganization add(UUID userId, String orgSlug, String role, UUID addedBy) {
        requireOrg(orgSlug);
        if (repo.existsByUserIdAndOrganization(userId, orgSlug)) {
            throw new ResourceAlreadyExistsException(
                "UserOrganization", userId + ":" + orgSlug);
        }
        return repo.save(new UserOrganization(userId, orgSlug,
            role != null ? requireValidRole(role) : MEMBER_ROLE, addedBy));
    }

    // Each email is either an existing user, added now and notified with a
    // push, or stored as a pending invite (re-inviting updates its role).
    // Emails outside the login allowlist are refused: they could never sign
    // in to claim the invite. Already-members are skipped.
    @Transactional
    public InviteResult invite(String orgSlug, List<String> rawEmails, String role, UUID invitedBy) {
        var org = requireOrg(orgSlug);
        var validRole = role != null ? requireValidRole(role) : MEMBER_ROLE;
        var emails = normalizeEmails(rawEmails);

        var existing = users.findByLowerEmailIn(emails).stream()
            .collect(Collectors.toMap(u -> u.getEmail().toLowerCase(Locale.ROOT), Function.identity(), (a, b) -> a));
        var added = new ArrayList<MemberView>();
        var pending = new ArrayList<InviteView>();
        for (var email : emails) {
            var user = existing.get(email);
            if (user == null) {
                invites.upsert(orgSlug, email, validRole, invitedBy);
                pending.add(new InviteView(email, validRole, OffsetDateTime.now()));
            } else if (!repo.existsByUserIdAndOrganization(user.getId(), orgSlug)) {
                var m = repo.save(new UserOrganization(user.getId(), orgSlug, validRole, invitedBy));
                added.add(view(m, user));
            }
        }
        if (!added.isEmpty()) {
            var name = org.getName() != null && !org.getName().isBlank() ? org.getName() : orgSlug;
            var ids = added.stream().map(MemberView::userId).collect(Collectors.toSet());
            events.publishEvent(new PushToUsers(ids, new PushMessage(
                name, "Te sumaron como miembro de " + name,
                Map.of(PushMessage.TYPE, "organization", PushMessage.ID, orgSlug))));
        }
        return new InviteResult(added, pending);
    }

    @Transactional
    public void revokeInvite(String orgSlug, String email) {
        if (email == null || invites.deleteOne(orgSlug, email.trim().toLowerCase(Locale.ROOT)) == 0) {
            throw new ResourceNotFoundException("OrgInvite", orgSlug + ":" + email);
        }
    }

    // Called once a never-seen email is provisioned: its pending invites
    // become memberships. Idempotent (ON CONFLICT DO NOTHING), so the race
    // fallback of provisioning may call it again.
    @Transactional
    public int claimInvites(UUID userId, String email) {
        if (userId == null || email == null) return 0;
        var lower = email.toLowerCase(Locale.ROOT);
        int claimed = invites.insertMembershipsFromInvites(userId, lower);
        invites.deleteByEmail(lower);
        return claimed;
    }

    // STAFF: no last-admin guard.
    @Transactional
    public UserOrganization updateRole(UUID userId, String orgSlug, String role) {
        return update(userId, orgSlug, role, null, null, false);
    }

    // Partial update: null = leave unchanged; a blank title clears it.
    // `guardLastAdmin` is false only for STAFF.
    @Transactional
    public UserOrganization update(UUID userId, String orgSlug, String role, String title, Boolean showOnPortal,
                                   boolean guardLastAdmin) {
        var membership = find(userId, orgSlug);
        if (role != null) {
            var validRole = requireValidRole(role);
            if (guardLastAdmin && ADMIN_ROLE.equals(membership.getRole()) && !ADMIN_ROLE.equals(validRole)) {
                requireAnotherAdmin(orgSlug, userId);
            }
            membership.setRole(validRole);
        }
        if (title != null) {
            var t = title.trim();
            if (t.length() > MAX_TITLE_LENGTH) {
                throw new ValidationException("title", title, "must be at most " + MAX_TITLE_LENGTH + " characters");
            }
            membership.setTitle(t.isEmpty() ? null : t);
        }
        if (showOnPortal != null) membership.setShowOnPortal(showOnPortal);
        return membership;
    }

    @Transactional(readOnly = true)
    public MemberView memberView(UUID userId, String orgSlug) {
        var m = find(userId, orgSlug);
        return view(m, users.findById(userId).orElse(null));
    }

    // STAFF: no last-admin guard.
    @Transactional
    public void remove(UUID userId, String orgSlug) {
        remove(userId, orgSlug, false);
    }

    // Silent no-op when the user is not a member (DELETE is idempotent).
    @Transactional
    public void remove(UUID userId, String orgSlug, boolean guardLastAdmin) {
        repo.findById(new UserOrganizationId(userId, orgSlug)).ifPresent(m -> {
            if (guardLastAdmin && ADMIN_ROLE.equals(m.getRole())) requireAnotherAdmin(orgSlug, userId);
            repo.delete(m);
        });
    }

    // Board handover: `toUserId` (already a member) becomes admin and the
    // calling admin steps down to member, in one transaction.
    @Transactional
    public void transferAdmin(String orgSlug, UUID fromUserId, UUID toUserId) {
        if (Objects.equals(fromUserId, toUserId)) {
            throw new ValidationException("userId", toUserId, "must be another member");
        }
        var target = find(toUserId, orgSlug);
        var current = find(fromUserId, orgSlug);
        repo.findAdminsForUpdate(orgSlug);
        target.setRole(ADMIN_ROLE);
        current.setRole(MEMBER_ROLE);
    }

    // Account deletion: refuse while the user is the only admin of any org.
    @Transactional
    public void requireNotLastAdmin(UUID userId) {
        for (var m : repo.findByUserId(userId)) {
            if (ADMIN_ROLE.equals(m.getRole())) requireAnotherAdmin(m.getOrganization(), userId);
        }
    }

    // Locks the org's admin rows first, so two admins stepping down at the
    // same time serialize and the second one sees it would be the last.
    private void requireAnotherAdmin(String orgSlug, UUID leavingUserId) {
        boolean another = repo.findAdminsForUpdate(orgSlug).stream()
            .anyMatch(a -> !a.getUserId().equals(leavingUserId));
        if (!another) throw new LastOrgAdminException(orgSlug);
    }

    private UserOrganization find(UUID userId, String orgSlug) {
        return repo.findById(new UserOrganizationId(userId, orgSlug))
            .orElseThrow(() -> new ResourceNotFoundException(
                "UserOrganization", userId + ":" + orgSlug));
    }

    private org.ceitba.api.domain.news.Organization requireOrg(String orgSlug) {
        return orgRepo.findById(orgSlug)
            .orElseThrow(() -> new ResourceNotFoundException("Organization", orgSlug));
    }

    private Map<UUID, User> usersById(List<UUID> ids) {
        return users.findAllById(ids).stream().collect(Collectors.toMap(User::getId, Function.identity()));
    }

    private static MemberView view(UserOrganization m, User u) {
        return new MemberView(m.getUserId(),
            u != null ? u.getName() : null, u != null ? u.getEmail() : null, u != null ? u.getAvatarUrl() : null,
            m.getRole(), m.getTitle(), m.isShowOnPortal(), m.getCreatedAt());
    }

    private Set<String> normalizeEmails(List<String> rawEmails) {
        if (rawEmails == null || rawEmails.isEmpty()) {
            throw new ValidationException("emails", rawEmails, "must not be empty");
        }
        if (rawEmails.size() > MAX_INVITES_PER_REQUEST) {
            throw new ValidationException("emails", rawEmails.size(), "at most " + MAX_INVITES_PER_REQUEST + " per request");
        }
        var out = new LinkedHashSet<String>();
        for (var raw : rawEmails) {
            var email = raw == null ? "" : raw.trim().toLowerCase(Locale.ROOT);
            if (email.length() > 320 || !EMAIL.matcher(email).matches()) {
                throw new ValidationException("emails", raw, "must be an email address");
            }
            if (!auth.admits(email)) {
                throw new ValidationException("emails", raw, "is not allowed to sign in");
            }
            out.add(email);
        }
        return out;
    }

    private static String requireValidRole(String role) {
        if (role == null || !ROLES.contains(role)) {
            throw new ValidationException("role", role, "must be one of " + ROLES);
        }
        return role;
    }
}
