package org.ceitba.api.service.sync;

import org.ceitba.api.common.exception.DomainException;

// A single Firestore document cannot be imported. Caught per document by
// FirestoreImportService and turned into a report error (it never reaches
// the HTTP layer); the message goes into the report, so it must never
// contain an email or other PII.
public class FirestoreImportException extends DomainException {

    public FirestoreImportException(String message) {
        super(message);
    }
}
