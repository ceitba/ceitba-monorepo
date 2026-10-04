package org.ceitba.api.web.error;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolationException;
import org.ceitba.api.common.exception.ExternalApiException;
import org.ceitba.api.config.ClockConfig;
import org.ceitba.api.common.exception.FeatureNotConfiguredException;
import org.ceitba.api.common.exception.InvalidStateException;
import org.ceitba.api.common.exception.RateLimitExceededException;
import org.ceitba.api.common.exception.ResourceAlreadyExistsException;
import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.common.exception.ValidationException;
import org.ceitba.api.service.auth.InvalidCredentialsException;
import org.ceitba.api.service.auth.InvalidTokenException;
import org.ceitba.api.service.auth.LoginRejectedException;
import org.ceitba.api.service.auth.ReviewAccountRestrictedException;
import org.ceitba.api.service.auth.ReviewLoginDisabledException;
import org.ceitba.api.service.capability.CapabilityRequiredException;
import org.ceitba.api.service.correction.ScheduleCorrectionException;
import org.ceitba.api.service.digest.DigestException;
import org.ceitba.api.service.mail.MailQuotaExhaustedException;
import org.ceitba.api.service.drive.DriveException;
import org.ceitba.api.service.kb.pipeline.KbPipelineException;
import org.ceitba.api.service.wiki.BookmarkLimitException;
import org.ceitba.api.service.studygroup.StudyGroupConflictException;
import org.ceitba.api.service.studygroup.StudyGroupForbiddenException;
import org.ceitba.api.service.user.FileNumberAlreadySetException;
import org.ceitba.api.service.user.FileNumberTakenException;
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

import java.time.Instant;
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

    @ExceptionHandler(FileNumberAlreadySetException.class)
    public ResponseEntity<ErrorResponse> handleFileNumberAlreadySet(FileNumberAlreadySetException ex, HttpServletRequest req) {
        return build(HttpStatus.CONFLICT, "FileNumberAlreadySet", ex.getMessage(), req);
    }

    @ExceptionHandler(FileNumberTakenException.class)
    public ResponseEntity<ErrorResponse> handleFileNumberTaken(FileNumberTakenException ex, HttpServletRequest req) {
        return build(HttpStatus.CONFLICT, "FileNumberTaken", ex.getMessage(), req);
    }

    @ExceptionHandler(StudyGroupConflictException.class)
    public ResponseEntity<ErrorResponse> handleStudyGroupConflict(StudyGroupConflictException ex, HttpServletRequest req) {
        return build(HttpStatus.CONFLICT, ex.reason().code(), ex.getMessage(), req);
    }

    // SameAsSga is a request problem (400); CommissionEnded and
    // AlreadySuggested conflict with the current state (409).
    @ExceptionHandler(ScheduleCorrectionException.class)
    public ResponseEntity<ErrorResponse> handleScheduleCorrection(ScheduleCorrectionException ex, HttpServletRequest req) {
        var status = ex.reason() == ScheduleCorrectionException.Reason.SAME_AS_SGA
            ? HttpStatus.BAD_REQUEST
            : HttpStatus.CONFLICT;
        return build(status, ex.reason().code(), ex.getMessage(), req);
    }

    // Drive sync (docs/DRIVE-SYNC.md): each reason carries its status and the
    // DRIVE_* code the SPA switches on; rate limits add Retry-After.
    @ExceptionHandler(DriveException.class)
    public ResponseEntity<ErrorResponse> handleDrive(DriveException ex, HttpServletRequest req) {
        var builder = ResponseEntity.status(ex.reason().status());
        if (ex.reason() == DriveException.Reason.SYNC_RATE_LIMITED && ex.retryAfterSeconds() > 0) {
            builder.header("Retry-After", Long.toString(ex.retryAfterSeconds()));
        }
        return builder.body(ErrorResponse.of(ex.reason().code(), ex.getMessage(), req.getRequestURI()));
    }

    // Weekly digest (docs/WEEKLY-DIGEST.md): INVALID_WEEK_START, DIGEST_EXISTS,
    // DIGEST_NOT_EDITABLE, DIGEST_EMPTY, EMAIL_NOT_ALLOWED, INVALID_TOKEN,
    // TOKEN_EXPIRED, INVALID_VOTE, CORRECTION_NOT_FOUND, CORRECTION_CLOSED.
    @ExceptionHandler(DigestException.class)
    public ResponseEntity<ErrorResponse> handleDigest(DigestException ex, HttpServletRequest req) {
        return ResponseEntity.status(ex.reason().status())
            .body(ErrorResponse.of(ex.reason().code(), ex.getMessage(), req.getRequestURI()));
    }

    // The sending account has no quota left (docs/WEEKLY-DIGEST.md, "Sending
    // quota"): 429 with Retry-After and `resumeAt`.
    @ExceptionHandler(MailQuotaExhaustedException.class)
    public ResponseEntity<MailQuotaErrorResponse> handleMailQuota(MailQuotaExhaustedException ex,
                                                                  HttpServletRequest req) {
        long retryAfter = Math.max(1, java.time.Duration.between(Instant.now(), ex.resumeAt()).toSeconds());
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
            .header("Retry-After", Long.toString(retryAfter))
            .body(new MailQuotaErrorResponse(MailQuotaExhaustedException.CODE, ex.getMessage(), req.getRequestURI(),
                Instant.now(), ex.resumeAt().atZone(ClockConfig.ZONE).toOffsetDateTime()));
    }

    @ExceptionHandler(KbPipelineException.class)
    public ResponseEntity<ErrorResponse> handleKbPipeline(KbPipelineException ex, HttpServletRequest req) {
        return ResponseEntity.status(ex.reason().status())
            .body(ErrorResponse.of(ex.reason().code(), ex.getMessage(), req.getRequestURI()));
    }

    @ExceptionHandler(BookmarkLimitException.class)
    public ResponseEntity<ErrorResponse> handleBookmarkLimit(BookmarkLimitException ex, HttpServletRequest req) {
        return build(HttpStatus.CONFLICT, "BOOKMARK_LIMIT", ex.getMessage(), req);
    }

    // The caller lacks a capability (docs/CAPABILITIES.md).
    @ExceptionHandler(CapabilityRequiredException.class)
    public ResponseEntity<ErrorResponse> handleCapabilityRequired(CapabilityRequiredException ex, HttpServletRequest req) {
        return build(HttpStatus.FORBIDDEN, "CAPABILITY_REQUIRED", ex.getMessage(), req);
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

    @ExceptionHandler(InvalidCredentialsException.class)
    public ResponseEntity<ErrorResponse> handleInvalidCredentials(InvalidCredentialsException ex, HttpServletRequest req) {
        return build(HttpStatus.UNAUTHORIZED, "invalid_credentials", ex.getMessage(), req);
    }

    // Review login not configured: indistinguishable from any other 404.
    @ExceptionHandler(ReviewLoginDisabledException.class)
    public ResponseEntity<ErrorResponse> handleReviewLoginDisabled(ReviewLoginDisabledException ex, HttpServletRequest req) {
        return build(HttpStatus.NOT_FOUND, "NotFound", ex.getMessage(), req);
    }

    @ExceptionHandler(ReviewAccountRestrictedException.class)
    public ResponseEntity<ErrorResponse> handleReviewAccountRestricted(ReviewAccountRestrictedException ex, HttpServletRequest req) {
        return build(HttpStatus.FORBIDDEN, "AccessDenied", ex.getMessage(), req);
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
        if (ex instanceof org.springframework.web.ErrorResponse mvcError) {
            return handleSpringMvc(ex, mvcError, req);
        }
        log.error("Unhandled exception at {}", req.getRequestURI(), ex);
        return build(HttpStatus.INTERNAL_SERVER_ERROR, "InternalServerError",
            "An unexpected error occurred", req);
    }

    // Spring MVC's own exceptions (405 wrong method, 415 wrong Content-Type,
    // 406, missing header, ...) carry their status. Without this they hit the
    // catch-all above and became 500s logged at ERROR. @ExceptionHandler only
    // matches classes, so the ErrorResponse interface is checked by hand. Keeps
    // the exception's headers (e.g. Allow on a 405).
    private ResponseEntity<ErrorResponse> handleSpringMvc(Exception ex, org.springframework.web.ErrorResponse mvcError,
                                                          HttpServletRequest req) {
        var code = mvcError.getStatusCode();
        if (code.is5xxServerError()) {
            log.error("Request failed at {}", req.getRequestURI(), ex);
        } else {
            log.debug("Request rejected at {}: {}", req.getRequestURI(), ex.getMessage());
        }
        var status = HttpStatus.resolve(code.value());
        String error = status != null ? pascalCase(status.name()) : "Error";
        String message = mvcError.getBody().getDetail() != null
            ? mvcError.getBody().getDetail()
            : (status != null ? status.getReasonPhrase() : "Request failed");
        return ResponseEntity.status(code)
            .headers(mvcError.getHeaders())
            .body(ErrorResponse.of(error, message, req.getRequestURI()));
    }

    // METHOD_NOT_ALLOWED -> MethodNotAllowed, matching "NotFound"/"BadRequest".
    private static String pascalCase(String enumName) {
        var sb = new StringBuilder();
        for (var part : enumName.split("_")) {
            if (part.isEmpty()) continue;
            sb.append(part.charAt(0)).append(part.substring(1).toLowerCase());
        }
        return sb.toString();
    }

    private ResponseEntity<ErrorResponse> build(HttpStatus status, String error, String message, HttpServletRequest req) {
        return ResponseEntity.status(status).body(ErrorResponse.of(error, message, req.getRequestURI()));
    }
}
