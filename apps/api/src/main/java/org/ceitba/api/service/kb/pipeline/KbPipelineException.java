package org.ceitba.api.service.kb.pipeline;

import org.ceitba.api.common.exception.DomainException;

// Pipeline errors with stable codes; GlobalExceptionHandler maps them.
public class KbPipelineException extends DomainException {

    public enum Reason {
        LLM_UNCONFIGURED("KB_LLM_UNCONFIGURED", 503),
        RUN_ACTIVE("KB_RUN_ACTIVE", 409),
        RUN_NOT_ACTIVE("KB_RUN_NOT_ACTIVE", 409),
        RUN_NOT_BLOCKED("KB_RUN_NOT_BLOCKED", 409),
        EVAL_ACTIVE("KB_EVAL_ACTIVE", 409),
        NO_PAIRS("KB_NO_PAIRS", 404);

        private final String code;
        private final int status;

        Reason(String code, int status) {
            this.code = code;
            this.status = status;
        }

        public String code() { return code; }
        public int status() { return status; }
    }

    private final Reason reason;

    public KbPipelineException(Reason reason, String message) {
        super(message);
        this.reason = reason;
    }

    public Reason reason() { return reason; }
}
