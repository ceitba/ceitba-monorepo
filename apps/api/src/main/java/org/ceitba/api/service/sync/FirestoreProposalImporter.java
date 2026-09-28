package org.ceitba.api.service.sync;

import java.util.List;
import java.util.Map;

// Imports one legacy Firestore 'Propuestas' document into the proposal
// tables (B5). The implementation is ProposalFirestoreImporter, which
// documents the field mapping; it is idempotent on the document id.
public interface FirestoreProposalImporter {

    // False while the proposal tables do not exist (FirestoreImportService
    // then skips every proposal with a warning).
    boolean isAvailable();

    // Called inside the per-document transaction (rolled back on dry runs).
    // Authors are resolved through user.firebase_uid, so the service always
    // imports 'Usuarios' before 'Propuestas'. Throw FirestoreImportException
    // for a document that cannot be imported; add to `warnings` for a field
    // that was dropped while the rest imported. Neither may contain PII.
    FirestoreImportReport.Outcome importProposal(String documentId, Map<String, Object> document,
                                                 List<String> warnings);
}
