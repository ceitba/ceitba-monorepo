package org.ceitba.api.web.staff.dto;

import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ValidatorFactory;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

// URL fields the public site renders as links/images only take absolute
// http(s) URLs (or blank): a javascript: href would run in a visitor's browser.
class PublicUrlFieldsValidationTest {

    private static final String EVIL = "javascript:alert(document.cookie)";
    private static final String OK = "https://example.com/x.png";

    private static ValidatorFactory factory;
    private static Validator validator;

    @BeforeAll
    static void setUp() {
        factory = Validation.buildDefaultValidatorFactory();
        validator = factory.getValidator();
    }

    @AfterAll
    static void tearDown() {
        factory.close();
    }

    private static CreateStaffMemberRequest createMember(String photo, String linkedin) {
        return new CreateStaffMemberRequest(2026, "it", 0, "Ana", "Rol", "Role", photo, linkedin, null);
    }

    private static UpdateStaffMemberRequest updateMember(String photo, String linkedin) {
        return new UpdateStaffMemberRequest(2026, "it", 0, "Ana", "Rol", "Role", photo, linkedin, null);
    }

    private static CreateBenefitCardRequest createCard(String image, String cta) {
        return new CreateBenefitCardRequest("gym", 0, "T", "T", null, null, image, cta,
            null, null, null, List.of(), List.of(), null, null, null, null, null);
    }

    private static UpdateBenefitCardRequest updateCard(String image, String cta) {
        return new UpdateBenefitCardRequest("gym", 0, "T", "T", null, null, image, cta,
            null, null, null, List.of(), List.of(), null, null, null, null, null);
    }

    private static List<String> paths(Set<? extends ConstraintViolation<?>> violations) {
        return violations.stream().map(v -> v.getPropertyPath().toString()).sorted().toList();
    }

    @Test
    void staffMemberUrlsRejectNonHttpSchemes() {
        assertThat(paths(validator.validate(createMember(EVIL, EVIL)))).containsExactly("linkedinUrl", "photoUrl");
        assertThat(paths(validator.validate(updateMember("data:text/html,x", "javascript:x"))))
            .containsExactly("linkedinUrl", "photoUrl");
    }

    @Test
    void staffMemberUrlsAcceptHttpBlankAndNull() {
        assertThat(validator.validate(createMember(OK, "http://linkedin.com/in/ana"))).isEmpty();
        assertThat(validator.validate(updateMember("", null))).isEmpty();
    }

    @Test
    void benefitCardUrlsRejectNonHttpSchemes() {
        assertThat(paths(validator.validate(createCard(EVIL, EVIL)))).containsExactly("ctaUrl", "imageUrl");
        assertThat(paths(validator.validate(updateCard(EVIL, "JavaScript:x")))).containsExactly("ctaUrl", "imageUrl");
    }

    @Test
    void benefitCardUrlsAcceptHttpBlankAndNull() {
        assertThat(validator.validate(createCard(OK, "https://gym.example/promo"))).isEmpty();
        assertThat(validator.validate(updateCard(null, ""))).isEmpty();
    }

    @Test
    void benefitLinkUrlRejectsNonHttpSchemes() {
        var evil = new UpdateBenefitRequest("--c", 0, EVIL, null, List.of(), List.of(), null, null);
        assertThat(paths(validator.validate(evil))).containsExactly("linkUrl");
        var ok = new UpdateBenefitRequest("--c", 0, OK, null, List.of(), List.of(), null, null);
        assertThat(validator.validate(ok)).isEmpty();
    }
}
