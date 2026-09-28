package org.ceitba.api.web.user.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

// PATCH /v1/me/profile. Every field is optional; null = leave alone, empty
// string = clear (except fileNumber, which cannot be cleared here).
//
//   fileNumber  the ITBA legajo, entered once by the user: accepted only while
//               the stored one is empty (409 FileNumberAlreadySet otherwise,
//               unless it is the same number) and unique across users (409
//               FileNumberTaken). Digits only, 5 or 6 of them without a
//               leading zero (legajos are 5-digit today; 6 leaves room to
//               grow). A JSON number is accepted too. Staff change it via
//               PATCH /v1/users/{id}/file-number.
//   careerId  a careers.id. Changing it without sending `plan` clears the plan.
//   plan      a plan id that must belong to the (resulting) career.
//   linkedin, instagram, discord
//             a handle, @handle or profile URL; stored as the bare handle.
public record UpdateProfileRequest(
    @Schema(type = "string", pattern = UpdateProfileRequest.FILE_NUMBER_PATTERN, example = "61234",
        description = "ITBA legajo. Settable once, while empty; afterwards only staff can change it.")
    @Pattern(regexp = UpdateProfileRequest.FILE_NUMBER_PATTERN,
        message = "must be the legajo: 5 or 6 digits, no leading zero")
    String fileNumber,
    @Size(max = 25) String careerId,
    @Size(max = 25) String plan,
    @Size(max = 255) String linkedin,
    @Size(max = 255) String instagram,
    @Size(max = 64) String discord
) {
    public static final String FILE_NUMBER_PATTERN = "^[1-9][0-9]{4,5}$";
}
