package org.ceitba.api.service.digest;

import java.util.Optional;
import java.util.UUID;

// Extension point for a per-recipient block inside the otherwise shared
// email (e.g. a future "Tu cuatrimestre" section). It is inserted between
// the shared content and the footer. Implementations build `html` from
// escaped content themselves (DigestRenderer.esc); it is inserted verbatim.
public interface DigestPersonalSection {

    record Section(String html, String text) {}

    // readerId is null for previews without a reader.
    Optional<Section> forReader(UUID readerId, DigestComposer.Issue issue);
}
