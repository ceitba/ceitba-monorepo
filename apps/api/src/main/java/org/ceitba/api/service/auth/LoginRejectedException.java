package org.ceitba.api.service.auth;

import org.ceitba.api.common.exception.DomainException;

// A Google identity that authenticated correctly but is not allowed in:
// unverified email, email outside the allowlist, or a Workspace (hd) domain
// that is not allowlisted. Mapped to 403 with `error` = reason code. The same
// codes are used as `?error=` on the web callback redirect.
public class LoginRejectedException extends DomainException {

    public enum Reason {
        UNVERIFIED_EMAIL("unverified_email", "Google account email is not verified"),
        NOT_ALLOWLISTED("unauthorized", "Email is not allowed to sign in"),
        WORKSPACE_NOT_ALLOWED("unauthorized_workspace", "Google Workspace domain is not allowed to sign in");

        private final String code;
        private final String message;

        Reason(String code, String message) {
            this.code = code;
            this.message = message;
        }

        public String code() { return code; }
    }

    private final Reason reason;

    public LoginRejectedException(Reason reason) {
        super(reason.message);
        this.reason = reason;
    }

    public Reason reason() { return reason; }
}
