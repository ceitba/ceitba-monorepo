package org.ceitba.api.service.staff;

import org.ceitba.api.common.exception.ValidationException;

// A new benefit category's slug is its primary key and public URL segment, so
// it must be lowercase letters/digits separated by single hyphens (2-40 chars),
// the same rule organizations use. Mapped to 400 "InvalidSlug".
public class InvalidBenefitSlugException extends ValidationException {

    public InvalidBenefitSlugException(String slug) {
        super("slug", slug, "must be 2-40 lowercase letters, digits or single hyphens");
    }
}
