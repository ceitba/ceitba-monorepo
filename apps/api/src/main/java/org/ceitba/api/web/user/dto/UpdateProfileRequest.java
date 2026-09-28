package org.ceitba.api.web.user.dto;

import jakarta.validation.constraints.Size;

// PATCH /v1/me/profile. Every field is optional; null = leave alone, empty
// string = clear. file_number is intentionally NOT here — it's identifying
// data and not editable from the profile page.
//
//   careerId  a careers.id. Changing it without sending `plan` clears the plan.
//   plan      a plan id that must belong to the (resulting) career.
//   linkedin, instagram, discord
//             a handle, @handle or profile URL; stored as the bare handle.
public record UpdateProfileRequest(
    @Size(max = 25) String careerId,
    @Size(max = 25) String plan,
    @Size(max = 255) String linkedin,
    @Size(max = 255) String instagram,
    @Size(max = 64) String discord
) {}
