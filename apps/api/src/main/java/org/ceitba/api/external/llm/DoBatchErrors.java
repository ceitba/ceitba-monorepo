package org.ceitba.api.external.llm;

import java.util.Locale;
import java.util.regex.Pattern;

// What a DigitalOcean batch error means for the caller.
//   RATE_LIMITED       429 / rate_limit_exceeded (batch_create_per_minute,
//                      batch_creations_per_hour): retry later, never fatal
//   UNSUPPORTED_MODEL  the JSONL's model id (or the model/provider) has no
//                      batch support, e.g. DO's validation failure
//                      'unsupported model "openai-gpt-6-luna": not available
//                      on DigitalOcean'
//   TRANSIENT          no response or 5xx: retry later
//   REJECTED           any other refusal (bad request, auth, account)
public final class DoBatchErrors {

    public enum Kind { RATE_LIMITED, UNSUPPORTED_MODEL, TRANSIENT, REJECTED }

    private static final Pattern UNSUPPORTED = Pattern.compile(
        "unsupported[_ -]model"
            + "|(model|provider)[_ -]?not[_ -]?supported"
            + "|(not|isn't|is not|un)[_ -]?(supported|available)[^.\\n]{0,40}\\bbatch"
            + "|\\bbatch(es|ing)?\\b[^.\\n]{0,60}(not|isn't|is not|un)[_ -]?(supported|available)"
            + "|does not support[^.\\n]{0,40}\\bbatch|doesn't support[^.\\n]{0,40}\\bbatch",
        Pattern.CASE_INSENSITIVE);

    private DoBatchErrors() {}

    // An HTTP error of a batch call (status 0 = no response).
    public static Kind classify(int status, String message) {
        if (status == 429 || rateLimited(message)) return Kind.RATE_LIMITED;
        if (status == 0 || status >= 500) return Kind.TRANSIENT;
        if (status >= 400 && unsupportedModel(message)) return Kind.UNSUPPORTED_MODEL;
        return Kind.REJECTED;
    }

    // The error_message of a batch DO reports as failed.
    public static Kind classifyFailure(String errorMessage) {
        if (rateLimited(errorMessage)) return Kind.RATE_LIMITED;
        return unsupportedModel(errorMessage) ? Kind.UNSUPPORTED_MODEL : Kind.REJECTED;
    }

    public static boolean unsupportedModel(String message) {
        return message != null && UNSUPPORTED.matcher(message).find();
    }

    static boolean rateLimited(String message) {
        if (message == null) return false;
        var m = message.toLowerCase(Locale.ROOT);
        return m.contains("rate_limit_exceeded") || m.contains("rate limit exceeded");
    }
}
