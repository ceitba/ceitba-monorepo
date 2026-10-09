package org.ceitba.api.service.news;

import org.ceitba.api.common.exception.ResourceAlreadyExistsException;
import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.domain.news.Organization;
import org.ceitba.api.repository.news.OrganizationRepository;
import org.ceitba.api.service.mail.MailSenderAccountService;
import org.ceitba.api.service.user.SocialHandles;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class OrganizationService {

    private final OrganizationRepository repo;
    private final MailSenderAccountService mailAccounts;

    public OrganizationService(OrganizationRepository repo, MailSenderAccountService mailAccounts) {
        this.repo = repo;
        this.mailAccounts = mailAccounts;
    }

    @Transactional(readOnly = true)
    public List<Organization> findAll() {
        return repo.findAll();
    }

    @Transactional(readOnly = true)
    public Organization findBySlug(String slug) {
        return repo.findById(slug)
            .orElseThrow(() -> new ResourceNotFoundException("Organization", slug));
    }

    @Transactional
    public Organization create(Organization org) {
        if (repo.existsById(org.getSlug())) {
            throw new ResourceAlreadyExistsException("Organization", org.getSlug());
        }
        return repo.save(org);
    }

    // Contact and recruiting fields of the profile (V54). In a PATCH, null
    // leaves a field unchanged and blank clears it.
    public record ProfileFields(String instagram, String linkedinUrl, String websiteUrl, String contactEmail,
                                Boolean recruitingOpen, String recruitingUrl, String recruitingText) {}

    // Applies `profile` to `org` (create, or a loaded org in update).
    public void applyProfile(Organization org, ProfileFields profile) {
        if (profile == null) return;
        if (profile.instagram() != null) {
            org.setInstagram(profile.instagram().isBlank() ? null : SocialHandles.instagram(profile.instagram()));
        }
        if (profile.linkedinUrl() != null)    org.setLinkedinUrl(blankToNull(profile.linkedinUrl()));
        if (profile.websiteUrl() != null)     org.setWebsiteUrl(blankToNull(profile.websiteUrl()));
        if (profile.contactEmail() != null)   org.setContactEmail(blankToNull(profile.contactEmail()));
        if (profile.recruitingOpen() != null) org.setRecruitingOpen(profile.recruitingOpen());
        if (profile.recruitingUrl() != null)  org.setRecruitingUrl(blankToNull(profile.recruitingUrl()));
        if (profile.recruitingText() != null) org.setRecruitingText(blankToNull(profile.recruitingText()));
    }

    @Transactional
    public Organization update(String slug, Organization patch) {
        return update(slug, patch, null);
    }

    @Transactional
    public Organization update(String slug, Organization patch, ProfileFields profile) {
        var org = findBySlug(slug);
        if (patch.getName()        != null) org.setName(patch.getName());
        if (patch.getFullName()    != null) org.setFullName(patch.getFullName());
        if (patch.getDescription() != null) org.setDescription(patch.getDescription());
        if (patch.getCategory()    != null) org.setCategory(patch.getCategory());
        if (patch.getColor()         != null) org.setColor(patch.getColor());
        if (patch.getLogoUrl()       != null) org.setLogoUrl(patch.getLogoUrl());
        if (patch.getBackgroundUrl() != null) org.setBackgroundUrl(patch.getBackgroundUrl());
        applyProfile(org, profile);
        return repo.save(org);
    }

    private static String blankToNull(String s) {
        return s.isBlank() ? null : s.trim();
    }

    @Transactional
    public void delete(String slug) {
        if (!repo.existsById(slug)) {
            throw new ResourceNotFoundException("Organization", slug);
        }
        // mail_sender_account.owner_ref has no FK: revoke and drop the org's Gmail account.
        mailAccounts.disconnectOrg(slug);
        repo.deleteById(slug);
    }
}
