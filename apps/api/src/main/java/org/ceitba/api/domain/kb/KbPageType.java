package org.ceitba.api.domain.kb;

import java.util.Locale;

// Frontmatter `type` (lowercase in Markdown and in responses).
public enum KbPageType {
    INDEX, TOPIC, CONCEPT;

    public String wire() {
        return name().toLowerCase(Locale.ROOT);
    }
}
