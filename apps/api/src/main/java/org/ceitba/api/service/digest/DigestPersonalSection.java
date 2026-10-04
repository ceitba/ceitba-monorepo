package org.ceitba.api.service.digest;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

// Extension point for the per-recipient block inside the otherwise shared
// email ("Tu cuatrimestre", service/digest/personal). It is inserted between
// the shared content and the footer. Implementations build `html` from
// escaped content themselves (DigestRenderer.esc); it is inserted verbatim.
public interface DigestPersonalSection {

    record Section(String html, String text) {}

    // The sections of many readers at once (the sending worker asks per page
    // of deliveries, so the data is batch-loaded). A reader without a section
    // is simply missing from the map.
    Map<UUID, Section> forReaders(Collection<UUID> readerIds, DigestComposer.Issue issue);

    // readerId is null for previews without a reader.
    default Optional<Section> forReader(UUID readerId, DigestComposer.Issue issue) {
        if (readerId == null) return Optional.empty();
        return Optional.ofNullable(forReaders(List.of(readerId), issue).get(readerId));
    }
}
