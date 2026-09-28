package org.ceitba.api.web.sync.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.List;
import java.util.Map;

// Body of POST /v1/sync/import/firestore: a snapshot of the legacy Firestore
// project as produced by scripts/firestore-export. Each array holds the
// documents of one collection with the document id added as "id" and
// Firestore Timestamps converted to ISO-8601 strings. Every array is
// optional; a missing one imports nothing for that collection.
//
// `propuestas` stays untyped: the legacy documents are loosely shaped (nested
// votes/comments/userNames maps) and ProposalFirestoreImporter owns the
// mapping and its validation.
@JsonIgnoreProperties(ignoreUnknown = true)
public record FirestoreExport(
    List<FirestoreUserDoc> usuarios,
    List<Map<String, Object>> propuestas,
    List<FirestoreBenefitDoc> benefits
) {

    public List<FirestoreUserDoc> usuariosOrEmpty() {
        return usuarios != null ? usuarios : List.of();
    }

    public List<Map<String, Object>> propuestasOrEmpty() {
        return propuestas != null ? propuestas : List.of();
    }

    public List<FirestoreBenefitDoc> benefitsOrEmpty() {
        return benefits != null ? benefits : List.of();
    }
}
