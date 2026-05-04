package org.ceitba.api.web.user;

import org.ceitba.api.domain.User;
import org.ceitba.api.service.news.OrganizationMembershipService;
import org.ceitba.api.web.auth.CurrentUser;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/v1/me/organizations")
public class MeOrganizationsController {

    private final OrganizationMembershipService memberships;

    public MeOrganizationsController(OrganizationMembershipService memberships) {
        this.memberships = memberships;
    }

    @GetMapping
    public List<OrgMembershipResponse> list(@CurrentUser User user) {
        return memberships.listForUser(user.getId()).stream()
            .map(m -> new OrgMembershipResponse(m.getOrganization(), m.getRole()))
            .toList();
    }

    public record OrgMembershipResponse(String slug, String role) {}
}
