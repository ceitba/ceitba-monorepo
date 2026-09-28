package org.ceitba.api.web.error;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolationException;
import org.ceitba.api.common.exception.ExternalApiException;
import org.ceitba.api.common.exception.FeatureNotConfiguredException;
import org.ceitba.api.common.exception.InvalidStateException;
import org.ceitba.api.common.exception.RateLimitExceededException;
import org.ceitba.api.common.exception.ResourceAlreadyExistsException;
import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.common.exception.ValidationException;
import org.ceitba.api.service.auth.InvalidTokenException;
import org.ceitba.api.service.auth.LoginRejectedException;
import org.ceitba.api.service.studygroup.StudyGroupConflictException;
import org.ceitba.api.service.studygroup.StudyGroupForbiddenException;
import org.ceitba.api.service.user.LastActiveStaffException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authorization.AuthorizationDeniedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import java.util.stream.Collectors;

// The ONE place exceptions become HTTP statuses. Controllers throw, services
// throw — neither translates. Keeps every endpoint's error shape uniform.
@ControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(ResourceNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleNotFound(ResourceNotFoundException ex, HttpServletRequest req) {
        return build(HttpStatus.NOT_FOUND, "ResourceNotFound", ex.getMessage(), req);
    }

    @ExceptionHandler(ResourceAlreadyExistsException.class)
    public ResponseEntity<ErrorResponse> handleConflict(ResourceAlreadyExistsException ex, HttpServletRequest req) {
        return build(HttpStatus.CONFLICT, "ResourceAlreadyExists", ex.getMessage(), req);
    }

    @ExceptionHandler(LastActiveStaffException.class)
    public ResponseEntity<ErrorResponse> handleLastActiveStaff(LastActiveStaffException ex, HttpServletRequest req) {
        return build(HttpStatus.CONFLICT, "LastActiveStaff", ex.getMessage(), req);
    }

    @ExceptionHandler(StudyGroupConflictException.class)
    public ResponseEntity<ErrorResponse> handleStudyGroupConflict(StudyGroupConflictException ex, HttpServletRequest req) {
        return build(HttpStatus.CONFLICT, ex.reason().code(), ex.getMessage(), req);
    }

    @ExceptionHandler(StudyGroupForbiddenException.class)
    public ResponseEntity<ErrorResponse> handleStudyGroupForbidden(StudyGroupForbiddenException ex, HttpServletRequest req) {
        return build(HttpStatus.FORBIDDEN, "AccessDenied", ex.getMessage(), req);
    }

    @ExceptionHandler(InvalidStateException.class)
    public ResponseEntity<ErrorResponse> handleInvalidState(InvalidStateException ex, HttpServletRequest req) {
        return build(HttpStatus.CONFLICT, "InvalidState", ex.getMessage(), req);
    }

    // Same body and headers RateLimitFilter writes for per-IP limits.
    @ExceptionHandler(RateLimitExceededException.class)
    public ResponseEntity<ErrorResponse> handleRateLimited(RateLimitExceededException ex, HttpServletRequest req) {
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
            .header("Retry-After", Long.toString(ex.retryAfterSeconds()))
            .body(ErrorResponse.of("TooManyRequests", ex.getMessage(), req.getRequestURI()));
    }

    @ExceptionHandler(ValidationException.class)
    public ResponseEntity<ErrorResponse> handleDomainValidation(ValidationException ex, HttpServletRequest req) {
        return build(HttpStatus.BAD_REQUEST, "ValidationError", ex.getMessage(), req);
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorResponse> handleBeanValidation(MethodArgumentNotValidException ex, HttpServletRequest req) {
        var details = ex.getBindingResult().getFieldErrors().stream()
            .map(fe -> fe.getField() + ": " + fe.getDefaultMessage())
            .collect(Collectors.joining("; "));
        return build(HttpStatus.BAD_REQUEST, "ValidationError", details, req);
    }

    @ExceptionHandler(ConstraintViolationException.class)
    public ResponseEntity<ErrorResponse> handleConstraintViolation(ConstraintViolationException ex, HttpServletRequest req) {
        return build(HttpStatus.BAD_REQUEST, "ValidationError", ex.getMessage(), req);
    }

    @ExceptionHandler({MissingServletRequestParameterException.class, MethodArgumentTypeMismatchException.class})
    public ResponseEntity<ErrorResponse> handleBadRequest(Exception ex, HttpServletRequest req) {
        return build(HttpStatus.BAD_REQUEST, "BadRequest", ex.getMessage(), req);
    }

    // Unparseable JSON or a value Jackson can't bind (e.g. an unknown enum
    // constant). Previously fell through to the catch-all 500. The parser's
    // message names internal classes, so it isn't echoed back.
    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ErrorResponse> handleUnreadableBody(HttpMessageNotReadableException ex, HttpServletRequest req) {
        return build(HttpStatus.BAD_REQUEST, "BadRequest", "Malformed or invalid request body", req);
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<ErrorResponse> handleDataIntegrity(DataIntegrityViolationException ex, HttpServletRequest req) {
        log.warn("Data integrity violation at {}: {}", req.getRequestURI(), ex.getMostSpecificCause().getMessage());
        return build(HttpStatus.CONFLICT, "DataIntegrityViolation",
            "Operation violates a database constraint", req);
    }

    @ExceptionHandler(ExternalApiException.class)
    public ResponseEntity<ErrorResponse> handleExternalApi(ExternalApiException ex, HttpServletRequest req) {
        log.error("External API error at {}", req.getRequestURI(), ex);
        return build(HttpStatus.BAD_GATEWAY, "ExternalApiError", ex.getMessage(), req);
    }

    @ExceptionHandler(FeatureNotConfiguredException.class)
    public ResponseEntity<ErrorResponse> handleNotConfigured(FeatureNotConfiguredException ex, HttpServletRequest req) {
        return build(HttpStatus.NOT_IMPLEMENTED, "NotImplemented", ex.getMessage(), req);
    }

    // Token endpoints (/v1/auth/google/mobile, /v1/auth/refresh). `error` is a
    // stable lowercase code the mobile app switches on — the same codes the
    // web callback puts in ?error=.
    @ExceptionHandler(InvalidTokenException.class)
    public ResponseEntity<ErrorResponse> handleInvalidToken(InvalidTokenException ex, HttpServletRequest req) {
        return build(HttpStatus.UNAUTHORIZED, "invalid_token", ex.getMessage(), req);
    }

    @ExceptionHandler(LoginRejectedException.class)
    public ResponseEntity<ErrorResponse> handleLoginRejected(LoginRejectedException ex, HttpServletRequest req) {
        return build(HttpStatus.FORBIDDEN, ex.reason().code(), ex.getMessage(), req);
    }

    // @PreAuthorize denial throws AuthorizationDeniedException (Spring 6.1+)
    // which extends AccessDeniedException. The @ControllerAdvice fires before
    // Spring Security's ExceptionTranslationFilter could translate it, so we
    // map it here. Order matters: place this before the catch-all Exception
    // handler so it gets matched first.
    @ExceptionHandler({AuthorizationDeniedException.class, AccessDeniedException.class})
    public ResponseEntity<ErrorResponse> handleAccessDenied(Exception ex, HttpServletRequest req) {
        return build(HttpStatus.FORBIDDEN, "AccessDenied", "Insufficient permissions", req);
    }

    @ExceptionHandler(NoResourceFoundException.class)
    public ResponseEntity<ErrorResponse> handleNoResourceFound(NoResourceFoundException ex, HttpServletRequest req) {
        return build(HttpStatus.NOT_FOUND, "NotFound", ex.getMessage(), req);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleUnexpected(Exception ex, HttpServletRequest req) {
        log.error("Unhandled exception at {}", req.getRequestURI(), ex);
        return build(HttpStatus.INTERNAL_SERVER_ERROR, "InternalServerError",
            "An unexpected error occurred", req);
    }

    private ResponseEntity<ErrorResponse> build(HttpStatus status, String error, String message, HttpServletRequest req) {
        return ResponseEntity.status(status).body(ErrorResponse.of(error, message, req.getRequestURI()));
    }
}
