package org.ceitba.api.service.sync;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

// Result of a Firestore import (web/sync/dto/FirestoreImportResponse maps it
// for POST /v1/sync/import/firestore). Top-level created/updated/skipped
// are totals over all collections; the per-collection counters break them
// down. Errors are per document (the document is left untouched); warnings
// flag a field that was dropped while the rest of the document imported.
// Entries carry the collection and Firestore document id, never an email.
public final class FirestoreImportReport {

    public enum Outcome { CREATED, UPDATED, SKIPPED }

    public record Issue(String collection, String id, String message) {}

    private final boolean dryRun;
    private final Counters usuarios = new Counters();
    private final Counters benefits = new Counters();
    private final Counters propuestas = new Counters();
    private final List<Issue> errors = new ArrayList<>();
    private final List<Issue> warnings = new ArrayList<>();

    public FirestoreImportReport(boolean dryRun) {
        this.dryRun = dryRun;
    }

    public boolean isDryRun() { return dryRun; }
    public long getCreated() { return usuarios.created + benefits.created + propuestas.created; }
    public long getUpdated() { return usuarios.updated + benefits.updated + propuestas.updated; }
    public long getSkipped() { return usuarios.skipped + benefits.skipped + propuestas.skipped; }
    public List<Issue> getErrors() { return Collections.unmodifiableList(errors); }
    public List<Issue> getWarnings() { return Collections.unmodifiableList(warnings); }
    public Counters getUsuarios() { return usuarios; }
    public Counters getBenefits() { return benefits; }
    public Counters getPropuestas() { return propuestas; }

    void error(String collection, String id, String message) {
        errors.add(new Issue(collection, id, message));
    }

    void warning(String collection, String id, String message) {
        warnings.add(new Issue(collection, id, message));
    }

    public static final class Counters {
        long created;
        long updated;
        long skipped;
        long errors;

        void count(Outcome outcome) {
            switch (outcome) {
                case CREATED -> created++;
                case UPDATED -> updated++;
                case SKIPPED -> skipped++;
            }
        }

        public long getCreated() { return created; }
        public long getUpdated() { return updated; }
        public long getSkipped() { return skipped; }
        public long getErrors() { return errors; }
    }
}
