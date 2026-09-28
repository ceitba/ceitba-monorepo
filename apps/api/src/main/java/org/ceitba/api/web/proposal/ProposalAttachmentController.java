package org.ceitba.api.web.proposal;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.ceitba.api.domain.User;
import org.ceitba.api.service.media.MediaUploadService;
import org.ceitba.api.web.auth.CurrentUser;
import org.ceitba.api.web.media.dto.SignUploadRequest;
import org.ceitba.api.web.media.dto.SignUploadResponse;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

// Any allowlisted user may sign uploads for proposal attachments: jpeg, png,
// webp (5 MB) or pdf (10 MB), rate-limited per user
// (rate-limit.user-rules.proposal-attachments). The returned `key` goes in
// POST /v1/proposals `attachmentKeys`. 501 when storage is not configured.
@Tag(name = "Proposals")
@RestController
@RequestMapping("/v1/proposals/attachments")
public class ProposalAttachmentController {

    private final MediaUploadService uploads;

    public ProposalAttachmentController(MediaUploadService uploads) {
        this.uploads = uploads;
    }

    @PostMapping("/sign-upload")
    @Operation(summary = "Sign a PUT upload of a proposal attachment")
    public SignUploadResponse signUpload(@CurrentUser User user, @RequestBody @Valid SignUploadRequest req) {
        return uploads.signProposalAttachment(user.getId(), req);
    }
}
