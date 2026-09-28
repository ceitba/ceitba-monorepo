package org.ceitba.api.domain;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/**
 * Conversions between the {@code String[]} fields used for Postgres array
 * columns and the {@code List<String>} that entity accessors expose.
 * See the note on {@code BenefitCard#bulletsEs} for why the fields are arrays.
 */
public final class StringArrays {

    private StringArrays() {}

    /** Read-only view; null column → empty list. */
    public static List<String> toList(String[] values) {
        return values == null ? List.of() : Collections.unmodifiableList(Arrays.asList(values));
    }

    /** Defensive copy; null → empty array. */
    public static String[] fromList(List<String> values) {
        return values == null ? new String[0] : values.toArray(String[]::new);
    }
}
