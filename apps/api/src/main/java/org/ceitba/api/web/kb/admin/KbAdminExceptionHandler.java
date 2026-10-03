package org.ceitba.api.web.kb.admin;

import jakarta.servlet.http.HttpServletRequest;
import org.ceitba.api.web.error.ErrorResponse;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

// Staff kb endpoints: a query/path parameter of the wrong type (a bad UUID,
// a non-numeric limit...) is a 400 ValidationError naming the parameter,
// never the raw conversion message.
@RestControllerAdvice(basePackageClasses = KbAdminExceptionHandler.class)
@Order(Ordered.HIGHEST_PRECEDENCE)
public class KbAdminExceptionHandler {

    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<ErrorResponse> typeMismatch(MethodArgumentTypeMismatchException ex, HttpServletRequest req) {
        var type = ex.getRequiredType() == null ? "value" : ex.getRequiredType().getSimpleName();
        var msg = ex.getName() + ": invalid " + type + " '" + ex.getValue() + "'";
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(ErrorResponse.of("ValidationError", msg,
            req.getRequestURI()));
    }
}
