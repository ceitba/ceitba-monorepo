package org.ceitba.api.service.user;

import org.ceitba.api.common.exception.DomainException;

// PATCH /v1/me/profile with a fileNumber while the user already has a
// different one. Users enter their legajo once; after that only staff can
// change it (PATCH /v1/users/{id}/file-number). Mapped to 409.
public class FileNumberAlreadySetException extends DomainException {

    public FileNumberAlreadySetException() {
        super("The file number is already set; ask CEITBA staff to change it.");
    }
}
