package org.ceitba.api.web.error;

import jakarta.servlet.http.HttpServletRequest;
import org.ceitba.api.common.exception.ExternalApiException;
import org.ceitba.api.common.exception.FeatureNotConfiguredException;
import org.ceitba.api.common.exception.ResourceAlreadyExistsException;
import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.common.exception.ValidationException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;

import static org.assertj.core.api.Assertions.assertThat;

class GlobalExceptionHandlerTest {

    private GlobalExceptionHandler handler;
    private HttpServletRequest req;

    @BeforeEach
    void setup() {
        handler = new GlobalExceptionHandler();
        var mock = new MockHttpServletRequest();
        mock.setRequestURI("/api/some/path");
        req = mock;
    }

    @Test
    void resourceNotFoundMapsTo404() {
        ResponseEntity<ErrorResponse> r = handler.handleNotFound(
            new ResourceNotFoundException("Subject", "XYZ"), req);

        assertThat(r.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(r.getBody().error()).isEqualTo("ResourceNotFound");
        assertThat(r.getBody().message()).isEqualTo("Subject with identifier 'XYZ' not found");
        assertThat(r.getBody().path()).isEqualTo("/api/some/path");
        assertThat(r.getBody().timestamp()).isNotNull();
    }

    @Test
    void resourceAlreadyExistsMapsTo409() {
        ResponseEntity<ErrorResponse> r = handler.handleConflict(
            new ResourceAlreadyExistsException("User", "alice@itba.edu.ar"), req);

        assertThat(r.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(r.getBody().error()).isEqualTo("ResourceAlreadyExists");
    }

    @Test
    void featureNotConfiguredMapsTo501() {
        ResponseEntity<ErrorResponse> r = handler.handleNotConfigured(
            new FeatureNotConfiguredException("Cloud storage not configured."), req);

        assertThat(r.getStatusCode()).isEqualTo(HttpStatus.NOT_IMPLEMENTED);
        assertThat(r.getBody().error()).isEqualTo("NotImplemented");
        assertThat(r.getBody().message()).isEqualTo("Cloud storage not configured.");
    }

    @Test
    void validationExceptionMapsTo400() {
        ResponseEntity<ErrorResponse> r = handler.handleDomainValidation(
            new ValidationException("year", -1, "must be non-negative"), req);

        assertThat(r.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(r.getBody().error()).isEqualTo("ValidationError");
        assertThat(r.getBody().message()).contains("year").contains("must be non-negative");
    }

    @Test
    void dataIntegrityViolationMapsTo409() {
        ResponseEntity<ErrorResponse> r = handler.handleDataIntegrity(
            new DataIntegrityViolationException("FK violation"), req);

        assertThat(r.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(r.getBody().error()).isEqualTo("DataIntegrityViolation");
        // Caller-facing message stays generic; internal cause is logged, not leaked.
        assertThat(r.getBody().message()).doesNotContain("FK violation");
    }

    @Test
    void externalApiExceptionMapsTo502() {
        ResponseEntity<ErrorResponse> r = handler.handleExternalApi(
            new ExternalApiException("ITBA", "getCommissions", new RuntimeException("timeout")), req);

        assertThat(r.getStatusCode()).isEqualTo(HttpStatus.BAD_GATEWAY);
        assertThat(r.getBody().error()).isEqualTo("ExternalApiError");
    }

    @Test
    void unhandledExceptionMapsTo500WithGenericMessage() {
        ResponseEntity<ErrorResponse> r = handler.handleUnexpected(
            new RuntimeException("internal detail clients should not see"), req);

        assertThat(r.getStatusCode()).isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR);
        assertThat(r.getBody().error()).isEqualTo("InternalServerError");
        assertThat(r.getBody().message()).isEqualTo("An unexpected error occurred");
        assertThat(r.getBody().message()).doesNotContain("internal detail");
    }
}
