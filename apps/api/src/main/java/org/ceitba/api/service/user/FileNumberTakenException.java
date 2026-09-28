package org.ceitba.api.service.user;

import org.ceitba.api.common.exception.DomainException;

// The file number already belongs to another user (user_file_number_key is
// unique). The number itself is not echoed back, so the response does not
// confirm whose legajo it is beyond what the caller already sent. Mapped to 409.
public class FileNumberTakenException extends DomainException {

    public FileNumberTakenException() {
        super("That file number is already registered to another account.");
    }
}
