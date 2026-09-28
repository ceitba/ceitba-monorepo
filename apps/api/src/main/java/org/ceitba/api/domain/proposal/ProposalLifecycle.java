package org.ceitba.api.domain.proposal;

import com.fasterxml.jackson.annotation.JsonCreator;

import java.util.Locale;

// Outcome of an approved proposal, set by moderators. Independent of the
// moderation status (org.ceitba.api.domain.ProposalStatus).
public enum ProposalLifecycle {
    ABIERTO,
    ACEPTADO,
    CERRADO;

    // Request bodies accept any case ("up", "Up", "UP").
    @JsonCreator
    public static ProposalLifecycle fromJson(String value) {
        return value == null ? null : valueOf(value.trim().toUpperCase(Locale.ROOT));
    }
}
