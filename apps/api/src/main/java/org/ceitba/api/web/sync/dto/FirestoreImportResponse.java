package org.ceitba.api.web.sync.dto;

import org.ceitba.api.service.sync.FirestoreImportReport;

import java.util.List;

// Body of POST /v1/sync/import/firestore. Top-level created/updated/skipped
// are totals over all collections; the per-collection counters break them
// down. Errors are per document (the document is left untouched); warnings
// flag a field that was dropped while the rest of the document imported.
// Entries carry the collection and Firestore document id, never an email.
public record FirestoreImportResponse(
    boolean dryRun,
    long created,
    long updated,
    long skipped,
    Counters usuarios,
    Counters benefits,
    Counters propuestas,
    List<Issue> errors,
    List<Issue> warnings
) {
    public record Counters(long created, long updated, long skipped, long errors) {
        static Counters from(FirestoreImportReport.Counters c) {
            return new Counters(c.getCreated(), c.getUpdated(), c.getSkipped(), c.getErrors());
        }
    }

    public record Issue(String collection, String id, String message) {
        static List<Issue> from(List<FirestoreImportReport.Issue> issues) {
            return issues.stream().map(i -> new Issue(i.collection(), i.id(), i.message())).toList();
        }
    }

    public static FirestoreImportResponse from(FirestoreImportReport report) {
        return new FirestoreImportResponse(
            report.isDryRun(),
            report.getCreated(),
            report.getUpdated(),
            report.getSkipped(),
            Counters.from(report.getUsuarios()),
            Counters.from(report.getBenefits()),
            Counters.from(report.getPropuestas()),
            Issue.from(report.getErrors()),
            Issue.from(report.getWarnings()));
    }
}
