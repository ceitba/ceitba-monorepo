package org.ceitba.api.domain.proposal;

import com.fasterxml.jackson.annotation.JsonCreator;

import java.util.Locale;

public enum ProposalVoteValue {
    UP,
    DOWN;

    // Request bodies accept any case ("up", "Up", "UP").
    @JsonCreator
    public static ProposalVoteValue fromJson(String value) {
        return value == null ? null : valueOf(value.trim().toUpperCase(Locale.ROOT));
    }
}
