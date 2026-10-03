package org.ceitba.api.domain.kb;

public enum KbPageStatus {
    // Visible to readers.
    PUBLISHED,
    // Staff, 3 reports or a source takedown; kept across imports until restored.
    HIDDEN,
    // Dropped by a `replace` import; a later import of the slug revives it.
    REMOVED
}
