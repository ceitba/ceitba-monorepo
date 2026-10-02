package org.ceitba.api.web.error;

import jakarta.servlet.http.HttpServletRequest;
import org.ceitba.api.common.exception.ExternalApiException;
import org.ceitba.api.common.exception.FeatureNotConfiguredException;
import org.ceitba.api.common.exception.ResourceAlreadyExistsException;
import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.common.exception.ValidationException;
import org.ceitba.api.service.studygroup.StudyGroupConflictException;
import org.ceitba.api.service.studygroup.StudyGroupForbiddenException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.mock.http.MockHttpInputMessage;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MissingRequestHeaderException;

import java.util.List;

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

    @Test
    void unreadableBodyMapsTo400WithoutEchoingParserDetails() {
        ResponseEntity<ErrorResponse> r = handler.handleUnreadableBody(
            new HttpMessageNotReadableException("Cannot deserialize value of type `org.x.Foo`",
                new MockHttpInputMessage(new byte[0])), req);

        assertThat(r.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(r.getBody().error()).isEqualTo("BadRequest");
        assertThat(r.getBody().message()).doesNotContain("org.x.Foo");
    }

    @Test
    void studyGroupConflictMapsTo409WithReasonCode() {
        ResponseEntity<ErrorResponse> r = handler.handleStudyGroupConflict(
            new StudyGroupConflictException(StudyGroupConflictException.Reason.FULL, "Study group is full"), req);

        assertThat(r.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(r.getBody().error()).isEqualTo("StudyGroupFull");
    }

    @Test
    void studyGroupForbiddenMapsTo403() {
        ResponseEntity<ErrorResponse> r = handler.handleStudyGroupForbidden(
            new StudyGroupForbiddenException("edit"), req);

        assertThat(r.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(r.getBody().error()).isEqualTo("AccessDenied");
    }

    @Test
    void methodNotSupportedMapsTo405WithAllowHeader() {
        ResponseEntity<ErrorResponse> r = handler.handleUnexpected(
            new HttpRequestMethodNotSupportedException("PUT", List.of("GET", "POST")), req);

        assertThat(r.getStatusCode()).isEqualTo(HttpStatus.METHOD_NOT_ALLOWED);
        assertThat(r.getBody().error()).isEqualTo("MethodNotAllowed");
        assertThat(r.getBody().path()).isEqualTo("/api/some/path");
        assertThat(r.getHeaders().getFirst(HttpHeaders.ALLOW)).contains("GET");
    }

    @Test
    void mediaTypeNotSupportedMapsTo415() {
        ResponseEntity<ErrorResponse> r = handler.handleUnexpected(
            new HttpMediaTypeNotSupportedException(MediaType.TEXT_PLAIN, List.of(MediaType.APPLICATION_JSON)), req);

        assertThat(r.getStatusCode()).isEqualTo(HttpStatus.UNSUPPORTED_MEDIA_TYPE);
        assertThat(r.getBody().error()).isEqualTo("UnsupportedMediaType");
    }

    @Test
    void missingRequestHeaderMapsTo400() throws Exception {
        var param = new org.springframework.core.MethodParameter(
            Object.class.getMethod("equals", Object.class), 0);
        ResponseEntity<ErrorResponse> r = handler.handleUnexpected(
            new MissingRequestHeaderException("X-Thing", param), req);

        assertThat(r.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(r.getBody().error()).isEqualTo("BadRequest");
    }
}
