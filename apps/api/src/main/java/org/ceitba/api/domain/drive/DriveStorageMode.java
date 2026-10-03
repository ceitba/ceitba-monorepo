package org.ceitba.api.domain.drive;

// COPY: binaries (PDFs, exports, originals, Doc images) are stored in MinIO.
// REFERENCE: only extracted text and Docs' sanitized HTML are kept;
// downloads and previews stream from Drive through the bot on request.
public enum DriveStorageMode {
    COPY,
    REFERENCE
}
